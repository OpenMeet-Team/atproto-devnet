# Test suite

The test suite validates all major operations against a running snowglobe:

| Test file | What it validates |
|-----------|-------------------|
| `health.test.ts` | All services respond to health checks |
| `account.test.ts` | Alice and Bob accounts were seeded correctly |
| `record-crud.test.ts` | Create, read, list, and delete ATProto records |
| `jetstream.test.ts` | JSON event stream delivers commit events, supports filtering |
| `firehose.test.ts` | Raw PDS firehose emits CBOR events |
| `isolation.test.ts` | PDS, Jetstream and Tap point only at the local PLC and the local PDS or relay, with no crawlers and no Bluesky AppView. It checks settings, not traffic |
| `tap.test.ts` | Tap accepts a DID to track. Live sync is not tested yet |

The `snowglobe-*.test.ts` files need no Docker: they check the file, what is rendered from it and
each command's refusals. For the snowglobe end to end on a machine, `node scripts/smoke.mjs`
runs the whole sequence (`check`, `up`, `account` on two PDSes, `invite`, `lexicons`, `app` add and
remove, `run`, `down -v`) on a copy of the checkout with its own state folder, as compose project `snowglobe-smoke` on
`127.0.0.3`, and prints one line per step; it exits 0 only when every step passed. Your own
snowglobes' state (`~/.local/share/snowglobe`) is not touched. It takes a few minutes, more on a first run that pulls the images.
