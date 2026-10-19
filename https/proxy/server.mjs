// A way into the https devnet for a browser on another computer, with no launch flags and no
// hosts file: a SOCKS5 proxy and the PAC file that points a browser at it, on one port. The browser
// asks the PAC which names go through the proxy; for those it hands the proxy the name itself
// (SOCKS5 resolves at the proxy), and the proxy connects every one of them to nginx. So every handle
// works the moment its account exists, and nothing the browser looks up anywhere else changes.
//
// The proxy reaches nginx and nothing else: a name outside the devnet, an IP address, a port other
// than 443 or a command other than CONNECT is refused. On the one port:
//
//   GET /proxy.pac           the devnet's names: <domain>, *.<domain>, *.devnet.internal
//   GET /proxy-with-plc.pac  the same plus plc.directory, for a browser used only for the devnet:
//                            plc.directory then means this devnet's PLC for every page in it
//   anything starting 0x05   SOCKS5
//
// The PAC names the proxy by the Host its request came in on, so it is right whatever port the
// browser's machine forwards. Settings:
//
//   PROXY_DOMAIN    the devnet's domain (DEVNET_DOMAIN)
//   PROXY_UPSTREAM  host:port every allowed name goes to (default nginx:443)
//   PROXY_BIND      host:port to listen on (default 0.0.0.0:1080)
import http from 'node:http'
import net from 'node:net'

const DOMAIN = (process.env.PROXY_DOMAIN ?? '').toLowerCase()
const [UP_HOST, UP_PORT] = (process.env.PROXY_UPSTREAM ?? 'nginx:443').split(':')
const [BIND_HOST, BIND_PORT] = (process.env.PROXY_BIND ?? '0.0.0.0:1080').split(':')
const HANDSHAKE_MS = 10_000

/** Whether a CONNECT to `name`:`port` goes to nginx. */
export function allowed(name, port, domain = DOMAIN) {
  const n = String(name).toLowerCase().replace(/\.$/, '')
  if (port !== 443 || !domain) return false
  return n === domain || n.endsWith(`.${domain}`) || n.endsWith('.devnet.internal') || n === 'plc.directory'
}

/** The PAC file: the devnet's names go to the SOCKS5 proxy at `proxy` (host:port), the rest direct. */
export function pac(proxy, domain = DOMAIN, withPlc = false) {
  const names = [`host == ${JSON.stringify(domain)}`, `dnsDomainIs(host, ${JSON.stringify(`.${domain}`)})`, 'dnsDomainIs(host, ".devnet.internal")']
  if (withPlc) names.push('host == "plc.directory"')
  return `// The https devnet at ${domain}: its names through its SOCKS5 proxy, which resolves them; the rest direct.
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  if (${names.join(' ||\n      ')}) {
    return "SOCKS5 ${proxy}";
  }
  return "DIRECT";
}
`
}

/** The Host a PAC request came in on, when it is a plain host:port; else null. */
export function proxyAddress(hostHeader) {
  const h = String(hostHeader ?? '')
  return /^[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(h) || /^\[[0-9a-fA-F:]+\]:[0-9]{1,5}$/.test(h) ? h : null
}

// SOCKS5 replies (RFC 1928): succeeded, general failure, not allowed, host unreachable, refused,
// command not supported, address type not supported.
const REP = { ok: 0, fail: 1, notAllowed: 2, unreachable: 4, refused: 5, badCommand: 7, badAddress: 8 }
const reply = (sock, rep) => sock.write(Buffer.from([5, rep, 0, 1, 0, 0, 0, 0, 0, 0]))

/**
 * Read a SOCKS5 greeting and CONNECT from `sock`, whose first bytes are `first`. Resolves to
 * { name, port } with the socket ready for the reply, or null once it has refused and closed it.
 */
export function readConnect(sock, first) {
  return new Promise((resolve) => {
    let buf = first
    let stage = 'greeting'
    const done = (v) => {
      // Paused, so nothing the browser sends before the reply is dropped; pipe() resumes it.
      sock.pause()
      sock.off('data', onData)
      clearTimeout(timer)
      resolve(v)
    }
    const refuse = (rep) => {
      if (rep !== undefined) reply(sock, rep)
      sock.end()
      done(null)
    }
    const timer = setTimeout(() => refuse(), HANDSHAKE_MS)
    const step = () => {
      if (stage === 'greeting') {
        if (buf.length < 2) return
        const n = buf[1]
        if (buf.length < 2 + n) return
        const methods = buf.subarray(2, 2 + n)
        buf = buf.subarray(2 + n)
        if (!methods.includes(0)) {
          sock.write(Buffer.from([5, 0xff]))
          return refuse()
        }
        sock.write(Buffer.from([5, 0]))
        stage = 'request'
      }
      if (buf.length < 4) return
      const [ver, cmd, , atyp] = buf
      if (ver !== 5) return refuse(REP.fail)
      if (cmd !== 1) return refuse(REP.badCommand)
      // Only a name: an address would skip the check on what the browser meant to reach.
      if (atyp !== 3) return refuse(atyp === 1 || atyp === 4 ? REP.notAllowed : REP.badAddress)
      if (buf.length < 5) return
      const len = buf[4]
      if (buf.length < 5 + len + 2) return
      const name = buf.subarray(5, 5 + len).toString('latin1')
      const port = buf.readUInt16BE(5 + len)
      const rest = buf.subarray(5 + len + 2)
      if (rest.length) sock.unshift(rest)
      done({ name, port })
    }
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk])
      step()
    }
    sock.on('data', onData)
    step()
  })
}

async function socks(sock, first) {
  const req = await readConnect(sock, first)
  if (!req) return
  if (!allowed(req.name, req.port)) {
    console.log(`proxy: refused ${req.name}:${req.port}`)
    reply(sock, REP.notAllowed)
    return sock.end()
  }
  const up = net.connect(Number(UP_PORT), UP_HOST)
  up.once('connect', () => {
    reply(sock, REP.ok)
    sock.pipe(up).pipe(sock)
  })
  up.on('error', (err) => {
    console.error(`proxy: ${req.name}: ${err.message}`)
    if (!sock.destroyed) {
      reply(sock, err.code === 'ECONNREFUSED' ? REP.refused : REP.unreachable)
      sock.end()
    }
  })
  sock.on('error', () => up.destroy())
  sock.once('close', () => up.destroy())
}

const pacServer = http.createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  const proxy = proxyAddress(req.headers.host)
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end()
  if ((path !== '/proxy.pac' && path !== '/proxy-with-plc.pac') || !proxy) return res.writeHead(404).end('not here\n')
  const body = pac(proxy, DOMAIN, path === '/proxy-with-plc.pac')
  res.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig', 'cache-control': 'no-cache' })
  res.end(req.method === 'HEAD' ? undefined : body)
})

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!DOMAIN) throw new Error('set PROXY_DOMAIN')
  net
    .createServer((sock) => {
      sock.on('error', () => {})
      sock.once('data', (first) => {
        if (first[0] === 5) return void socks(sock, first)
        sock.unshift(first)
        pacServer.emit('connection', sock)
      })
    })
    .listen(Number(BIND_PORT), BIND_HOST, () => console.log(`proxy: listening on ${BIND_HOST}:${BIND_PORT} for ${DOMAIN}, to ${UP_HOST}:${UP_PORT}`))
}
