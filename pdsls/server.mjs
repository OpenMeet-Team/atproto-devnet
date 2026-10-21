// PDSls (pds.ls) for this network: the record browser apps link to, built from a pinned upstream
// commit with network.patch, which lets a host page give it the network's addresses. This serves
// the built app with those addresses injected, its own OAuth client metadata, and the three
// lookups the app falls back to when a browser fetch fails, answered from inside the network only.
// pds.ls's own Worker also renders link previews and favicons from the public network; this does
// not.
//
//   GET /resolve-handle-http?handle=<h>   https://<h>/.well-known/atproto-did, <h> under the domain
//   GET /resolve-did-web?host=<h>         https://<h>/.well-known/did.json, <h> under the domain
//   GET /oauth-client-metadata.json       a public client at PDSLS_PUBLIC_URL
//   GET /_health                          200
//   anything else                         a file of the app, else the app itself (it routes in the page)
//
// Settings:
//   PDSLS_PUBLIC_URL        where browsers reach this, e.g. https://pdsls.local.snowglobe.at
//   PDSLS_DOMAIN            the network's domain; lookups outside it are refused
//   PDSLS_PLC_URL           the network's PLC directory
//   PDSLS_JETSTREAM_URL     the stream page's default Jetstream (wss://.../subscribe)
//   PDSLS_FIREHOSE_URL      the stream page's default relay or PDS (wss://...)
//   PDSLS_LEXICON_AUTHORITY the DID that holds every lexicon on the network (optional)
//   PDSLS_UPSTREAM          host:port to send every lookup to, ignoring DNS (the devnet's nginx);
//                           unset, names resolve as usual (a globe's public names)
//   PDSLS_DIST              the built app (default ./dist)
//   PDSLS_BIND              host:port to listen on (default 0.0.0.0:8080)
// A lookup verifies TLS against the system's CAs plus NODE_EXTRA_CA_CERTS (the devnet's CA).
import dns from 'node:dns'
import { readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { extname, join, resolve, sep } from 'node:path'

const env = process.env
const PUBLIC_URL = (env.PDSLS_PUBLIC_URL ?? '').replace(/\/+$/, '')
const DOMAIN = (env.PDSLS_DOMAIN ?? '').toLowerCase()
const DIST = env.PDSLS_DIST ?? new URL('./dist', import.meta.url).pathname
const [BIND_HOST, BIND_PORT] = (env.PDSLS_BIND ?? '0.0.0.0:8080').split(':')
const [UP_HOST, UP_PORT] = (env.PDSLS_UPSTREAM ?? '').split(':')
const LOOKUP_MS = 5_000
const MAX_BYTES = 64 * 1024

/** Whether `host` is the network's domain or a name under it. */
export const inNetwork = (host, domain = DOMAIN) => {
  const h = String(host).toLowerCase()
  return Boolean(domain) && /^[a-z0-9.-]+$/.test(h) && (h === domain || h.endsWith(`.${domain}`))
}

/** The settings the app reads as globalThis.PDSLS_NETWORK. Services the network lacks are null. */
export function networkSettings(e = env) {
  return {
    plcDirectory: e.PDSLS_PLC_URL,
    dohUrl: null,
    lexiconAuthority: e.PDSLS_LEXICON_AUTHORITY || undefined,
    appviewUrl: null,
    constellationUrl: null,
    jetstreamUrl: e.PDSLS_JETSTREAM_URL || null,
    firehoseUrl: e.PDSLS_FIREHOSE_URL || null,
    spacedustUrl: null,
    oauthAtOrigin: true,
  }
}

/**
 * The app's index.html with the network's settings set before any of its scripts run, and the
 * public font host dropped (the text falls back to the browser's monospace font).
 */
export function injectSettings(html, settings) {
  // JSON in a script element: escape what could end it.
  const json = JSON.stringify(settings).replace(/</g, '\\u003c')
  const tag = `<script>globalThis.PDSLS_NETWORK = ${json};</script>`
  return html
    .replace(/\s*<link[^>]+fonts\.bunny\.net[^>]*>/g, '')
    .replace(/<head>/, `<head>\n    ${tag}`)
}

/** OAuth client metadata for a public browser client at `base`, with the scope pds.ls asks for. */
export function clientMetadata(base) {
  return {
    client_id: `${base}/oauth-client-metadata.json`,
    client_name: 'PDSls',
    client_uri: base,
    logo_uri: `${base}/favicon.ico`,
    redirect_uris: [`${base}/`],
    scope:
      'atproto repo:*?action=create repo:*?action=update repo:*?action=delete blob:*/* space:*?authority=*&action=read space:*?authority=*&collection=*&action=create&action=update&action=delete space:*?manage=create&manage=update&manage=delete',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  }
}

/** GET https://<host><path>; with PDSLS_UPSTREAM, connected there whatever the name resolves to. */
function lookup(host, path, accept) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host,
        servername: host,
        path,
        headers: { accept, 'user-agent': 'pdsls-network/1' },
        timeout: LOOKUP_MS,
        ...(UP_HOST ? { lookup: (_name, opts, cb) => dns.lookup(UP_HOST, opts, cb), port: Number(UP_PORT) } : {}),
      },
      (res) => {
        let size = 0
        const chunks = []
        res.on('data', (c) => {
          size += c.length
          if (size > MAX_BYTES) req.destroy(new Error('too large'))
          else chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }))
      },
    )
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', reject)
  })
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.xml': 'application/xml', '.cur': 'image/x-icon' }

/** The file of the app at URL path `path` (still percent-encoded), or null. */
function file(path) {
  try {
    // Inside the folder, not merely starting with its name: /..%2fdist-backup/x is /app/dist-backup/x.
    const root = resolve(DIST)
    const full = join(root, decodeURIComponent(path))
    if (!full.startsWith(root + sep) || !statSync(full).isFile()) return null
    return full
  } catch {
    return null
  }
}

let indexHtml = null
const index = () => (indexHtml ??= injectSettings(readFileSync(join(DIST, 'index.html'), 'utf8'), networkSettings()))

async function serve(req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end()
  const send = (status, type, body, extra = {}) => {
    res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  if (url.pathname === '/_health') return send(200, 'text/plain', 'ok\n')
  if (url.pathname === '/oauth-client-metadata.json') {
    return send(200, 'application/json', JSON.stringify(clientMetadata(PUBLIC_URL), null, 2) + '\n', { 'cache-control': 'no-cache' })
  }
  const lookups = {
    '/resolve-handle-http': ['handle', '/.well-known/atproto-did', 'text/plain'],
    '/resolve-did-web': ['host', '/.well-known/did.json', 'application/did+ld+json,application/json'],
  }
  if (url.pathname in lookups) {
    const [param, path, accept] = lookups[url.pathname]
    const host = url.searchParams.get(param) ?? ''
    if (!inNetwork(host)) return send(400, 'text/plain', `${param} is not on this network\n`)
    try {
      const r = await lookup(host, path, accept)
      return send(r.status, r.type ?? 'application/octet-stream', r.body)
    } catch (err) {
      return send(502, 'text/plain', `lookup failed: ${err.message}\n`)
    }
  }
  if (url.pathname === '/resolve-handle-dns' || url.pathname === '/og-image' || url.pathname === '/favicon') {
    return send(404, 'text/plain', 'not on this network\n')
  }

  const path = file(url.pathname)
  if (path && !path.endsWith('index.html')) {
    const immutable = url.pathname.startsWith('/assets/')
    return send(200, TYPES[extname(path)] ?? 'application/octet-stream', readFileSync(path), {
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
  }
  // Every other path is a page of the app.
  return send(200, TYPES['.html'], index(), { 'cache-control': 'no-cache' })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const v of ['PDSLS_PUBLIC_URL', 'PDSLS_DOMAIN', 'PDSLS_PLC_URL']) if (!env[v]) throw new Error(`set ${v}`)
  index()
  http
    .createServer((req, res) =>
      serve(req, res).catch((err) => {
        console.error('pdsls:', req.url, err.message)
        if (!res.headersSent) res.writeHead(500).end()
      }),
    )
    .listen(Number(BIND_PORT), BIND_HOST, () => console.log(`pdsls: listening on ${BIND_HOST}:${BIND_PORT} for ${DOMAIN} at ${PUBLIC_URL}`))
}
