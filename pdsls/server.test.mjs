// node --test pdsls/server.test.mjs
import assert from 'node:assert/strict'
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
