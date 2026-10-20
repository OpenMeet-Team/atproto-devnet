// node --test https/proxy/server.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { allowed, connectTarget, pac, proxyAddress } from './server.mjs'

test('only the devnet names on 443 go to nginx', () => {
  for (const n of ['devnet.test', 'alpha.devnet.test', 'alice.devnet.test', 'x.regular.devnet.test', 'atmo.devnet.internal', 'plc.directory', 'ALPHA.devnet.test.']) {
    assert.equal(allowed(n, 443, 'devnet.test'), true, n)
  }
  for (const n of ['evil-devnet.test', 'devnet.test.example.com', 'bsky.social', 'plc.directory.evil', '127.0.0.1', 'devnet.internal']) {
    assert.equal(allowed(n, 443, 'devnet.test'), false, n)
  }
  assert.equal(allowed('alpha.devnet.test', 80, 'devnet.test'), false)
  assert.equal(allowed('alpha.devnet.test', 443, ''), false)
})

// The PAC helpers a browser gives FindProxyForURL, enough of them for this file.
const runPac = (src, host) => new Function('dnsDomainIs', `${src}; return FindProxyForURL("https://" + ${JSON.stringify(host)} + "/", ${JSON.stringify(host)})`)((h, d) => h.endsWith(d))

test('the PAC sends the devnet names to the proxy and the rest direct', () => {
  const src = pac('127.0.0.1:1090', 'devnet.test')
  for (const h of ['devnet.test', 'alice.devnet.test', 'Alpha.Devnet.Test', 'atmo.devnet.internal']) assert.equal(runPac(src, h), 'PROXY 127.0.0.1:1090', h)
  for (const h of ['plc.directory', 'bsky.app', 'evil-devnet.test', 'devnet.test.example.com']) assert.equal(runPac(src, h), 'DIRECT', h)
  assert.equal(runPac(pac('127.0.0.1:1090', 'devnet.test', true), 'plc.directory'), 'PROXY 127.0.0.1:1090')
})

test('the PAC names the proxy only by a plain host:port', () => {
  assert.equal(proxyAddress('127.0.0.1:1090'), '127.0.0.1:1090')
  assert.equal(proxyAddress('localhost:1090'), 'localhost:1090')
  assert.equal(proxyAddress('[::1]:1090'), '[::1]:1090')
  for (const h of ['127.0.0.1', '"; return "DIRECT', 'a b:1', undefined]) assert.equal(proxyAddress(h), null, String(h))
})

// A running proxy in front of an echo server standing in for nginx.
async function harness(t) {
  const echo = net.createServer((s) => s.on('error', () => {}).pipe(s)).listen(0, '127.0.0.1')
  await once(echo, 'listening')
  const probe = net.createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  probe.close()
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { ...process.env, PROXY_DOMAIN: 'devnet.test', PROXY_UPSTREAM: `127.0.0.1:${echo.address().port}`, PROXY_BIND: `127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => {
    child.kill()
    echo.close()
  })
  // Keep reading its output: a closed pipe would end the proxy at its next log line.
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  while (!out.includes('listening')) await once(child.stdout, 'data')
  return port
}

// Read from `sock` until `n` bytes have arrived.
async function read(sock, n) {
  let buf = Buffer.alloc(0)
  while (buf.length < n) {
    const chunk = sock.read()
    if (chunk) buf = Buffer.concat([buf, chunk])
    else if (sock.readableEnded) break
    else await Promise.race([once(sock, 'readable'), once(sock, 'end')])
  }
  return buf
}

function connectRequest(name, port) {
  const n = Buffer.from(name)
  const p = Buffer.alloc(2)
  p.writeUInt16BE(port)
  return Buffer.concat([Buffer.from([5, 1, 0, 3, n.length]), n, p])
}

test('SOCKS5: an allowed name is spliced to nginx, the rest refused', async (t) => {
  const port = await harness(t)

  const ok = net.connect(port, '127.0.0.1')
  await once(ok, 'connect')
  ok.write(Buffer.from([5, 1, 0]))
  assert.deepEqual([...(await read(ok, 2))], [5, 0])
  ok.write(connectRequest('alice.devnet.test', 443))
  assert.equal((await read(ok, 10))[1], 0)
  ok.write('hello')
  assert.equal(String(await read(ok, 5)), 'hello')
  ok.destroy()

  for (const [name, p] of [['bsky.social', 443], ['alpha.devnet.test', 80]]) {
    const no = net.connect(port, '127.0.0.1')
    await once(no, 'connect')
    no.write(Buffer.concat([Buffer.from([5, 1, 0]), connectRequest(name, p)]))
    const r = await read(no, 12)
    assert.equal(r[3], 2, `${name}:${p} not allowed`)
    no.destroy()
  }

  // An IP address, even the upstream's own, is refused.
  const ip = net.connect(port, '127.0.0.1')
  await once(ip, 'connect')
  ip.write(Buffer.from([5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1, 1, 187]))
  assert.equal((await read(ip, 12))[3], 2)
  ip.destroy()
})

test('the same port serves the PAC, naming the address it was asked on', async (t) => {
  const port = await harness(t)
  const res = await fetch(`http://127.0.0.1:${port}/proxy.pac`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), new RegExp(`PROXY 127\\.0\\.0\\.1:${port}`))
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404)
})

test('a request whose target is not a URL gets 400, and the proxy stays up', async (t) => {
  const port = await harness(t)
  const s = net.connect(port, '127.0.0.1')
  s.on('error', () => {})
  await once(s, 'connect')
  s.write('GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
  assert.match(String(await read(s, 12)), /^HTTP\/1\.1 400/)
  s.destroy()
  assert.equal((await fetch(`http://127.0.0.1:${port}/_health`)).status, 200)
})

test('a CONNECT names a name and a port, never an address', () => {
  assert.deepEqual(connectTarget('alice.devnet.test:443'), { name: 'alice.devnet.test', port: 443 })
  for (const t of ['127.0.0.1:443', '[::1]:443', 'alice.devnet.test', 'a b:443', '/path']) assert.equal(connectTarget(t), null, t)
})

// Send an HTTP CONNECT and read the status line and anything after the blank line.
async function httpConnect(port, target) {
  const s = net.connect(port, '127.0.0.1')
  s.on('error', () => {})
  await once(s, 'connect')
  s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
  let buf = ''
  while (!buf.includes('\r\n\r\n')) {
    const [d] = await Promise.race([once(s, 'data'), once(s, 'end').then(() => [''])])
    if (!d) break
    buf += d
  }
  return { sock: s, status: buf.split('\r\n')[0] }
}

test('HTTP CONNECT: an allowed name is spliced to nginx, the rest refused', async (t) => {
  const port = await harness(t)
  const ok = await httpConnect(port, 'alice.devnet.test:443')
  assert.equal(ok.status, 'HTTP/1.1 200 Connection Established')
  ok.sock.write('hello')
  assert.equal(String(await read(ok.sock, 5)), 'hello')
  ok.sock.destroy()
  for (const target of ['bsky.social:443', 'alpha.devnet.test:80', '127.0.0.1:443']) {
    const no = await httpConnect(port, target)
    assert.equal(no.status, 'HTTP/1.1 403 Forbidden', target)
    no.sock.destroy()
  }
})
