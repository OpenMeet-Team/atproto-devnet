// node --test stack/pdsls/server.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clientMetadata, injectSettings, inNetwork, networkSettings } from './server.mjs'

test('only names under the domain are looked up', () => {
  for (const h of ['devnet.test', 'alice.devnet.test', 'g.gh.devnet.test', 'ALICE.devnet.test']) assert.equal(inNetwork(h, 'devnet.test'), true, h)
  for (const h of ['evil-devnet.test', 'devnet.test.example.com', 'bsky.social', 'a/b.devnet.test', '', 'alice.devnet.test:443']) {
    assert.equal(inNetwork(h, 'devnet.test'), false, h)
  }
  assert.equal(inNetwork('alice.devnet.test', ''), false)
})

test('the network has no DNS, search, backlinks or spacedust, and signs in at its own origin', () => {
  const s = networkSettings({ PDSLS_PLC_URL: 'https://plc.devnet.test', PDSLS_JETSTREAM_URL: 'wss://jetstream.devnet.test/subscribe' })
  assert.equal(s.plcDirectory, 'https://plc.devnet.test')
  assert.equal(s.jetstreamUrl, 'wss://jetstream.devnet.test/subscribe')
  for (const k of ['dohUrl', 'appviewUrl', 'constellationUrl', 'spacedustUrl', 'firehoseUrl']) assert.equal(s[k], null, k)
  assert.equal(s.oauthAtOrigin, true)
})

test('the settings come before every script, and the public font host is gone', () => {
  const html = `<!doctype html><html><head>
    <link rel="preconnect" href="https://fonts.bunny.net" />
    <link href="https://fonts.bunny.net/css?family=roboto-mono:400,500" rel="stylesheet" />
    <script type="module" src="/assets/index.js"></script></head><body></body></html>`
  const out = injectSettings(html, { plcDirectory: 'https://plc.devnet.test', note: '</script><b>' })
  assert.ok(out.indexOf('PDSLS_NETWORK') < out.indexOf('/assets/index.js'))
  assert.ok(!out.includes('fonts.bunny.net'))
  assert.ok(!out.includes('</script><b>'), 'a value cannot close the script element')
})

test('the client metadata names this origin', () => {
  const m = clientMetadata('https://pdsls.devnet.test')
  assert.equal(m.client_id, 'https://pdsls.devnet.test/oauth-client-metadata.json')
  assert.deepEqual(m.redirect_uris, ['https://pdsls.devnet.test/'])
  assert.equal(m.token_endpoint_auth_method, 'none')
})

// A running server over a built app in a temporary folder, with a sibling folder beside it whose
// name starts with the app folder's, and every lookup sent to a port nothing listens on.
async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'pdsls-'))
  await mkdir(join(root, 'dist', 'assets'), { recursive: true })
  await mkdir(join(root, 'dist-backup'))
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><head><title>app</title></head></html>')
  await writeFile(join(root, 'dist', 'assets', 'a.js'), 'export {}')
  await writeFile(join(root, 'dist-backup', 'secret.txt'), 'secret')
  const free = async () => {
    const s = net.createServer().listen(0, '127.0.0.1')
    await once(s, 'listening')
    const { port } = s.address()
    s.close()
    return port
  }
  const port = await free()
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: {
      ...process.env,
      PDSLS_PUBLIC_URL: 'https://pdsls.devnet.test',
      PDSLS_DOMAIN: 'devnet.test',
      PDSLS_PLC_URL: 'https://plc.devnet.test',
      PDSLS_UPSTREAM: `127.0.0.1:${await free()}`,
      PDSLS_DIST: join(root, 'dist'),
      PDSLS_BIND: `127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(async () => {
    child.kill()
    await rm(root, { recursive: true, force: true })
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  while (!out.includes('listening')) await once(child.stdout, 'data')
  return (path) => fetch(`http://127.0.0.1:${port}${path}`)
}

test('the server answers its routes, and looks up only names under the domain', async (t) => {
  const get = await harness(t)
  assert.equal((await get('/_health')).status, 200)
  assert.equal((await (await get('/oauth-client-metadata.json')).json()).client_id, 'https://pdsls.devnet.test/oauth-client-metadata.json')
  for (const path of ['/resolve-handle-http?handle=bsky.social', '/resolve-handle-http?handle=alice.devnet.test.example.com', '/resolve-did-web?host=evil-devnet.test', '/resolve-did-web']) {
    assert.equal((await get(path)).status, 400, path)
  }
  // A name under the domain is looked up, at the upstream, where nothing answers.
  for (const path of ['/resolve-handle-http?handle=alice.devnet.test', '/resolve-did-web?host=alice.devnet.test']) {
    assert.equal((await get(path)).status, 502, path)
  }
  assert.equal((await get('/og-image')).status, 404)
})

test('the server serves the app, and no file outside its folder', async (t) => {
  const get = await harness(t)
  const js = await get('/assets/a.js')
  assert.equal(js.headers.get('content-type'), 'text/javascript')
  assert.equal(await js.text(), 'export {}')
  const page = await (await get('/at/alice.devnet.test')).text()
  assert.match(page, /globalThis\.PDSLS_NETWORK = .*plc\.devnet\.test/)
  for (const path of ['/..%2fdist-backup/secret.txt', '/%2e%2e/dist-backup/secret.txt', '/assets/..%2f..%2f..%2fdist-backup/secret.txt', '/%E0%A4%A']) {
    const res = await get(path)
    assert.equal(res.status, 200, path)
    assert.equal(await res.text(), page, `${path} is a page of the app`)
  }
})
