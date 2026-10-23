# Statusphere (not yet run in CI)

> **Run by hand, not yet by CI.** Sign-in, posting a status and the feed of other people's statuses
> work, in the steps below, run once in a headless browser with the statuses written by password
> sessions. A sign-in and a click through the app in a real browser, and a CI run of the whole
> flow, are not done yet (see [What is left](#what-is-left)).

[Statusphere](https://github.com/bluesky-social/statusphere-example-app) is the atproto example app:
sign in with a handle, pick an emoji, and the app writes an `xyz.statusphere.status` record to your
account. It is a Next.js app, and it runs on [a snowglobe](../snowglobe.md) with two small changes to
the app. The rest is the snowglobe's own tools.

## The snowglobe

Start from [`snowglobe.default.yml`](../../snowglobe.default.yml) and add the app:

```yaml
services:
  tap:
    webhook: ${apps.statusphere.url}/api/webhook
    signal_collection: xyz.statusphere.status

apps:
  - name: statusphere
    local: { port: 3000 }          # where `pnpm dev` listens; Next picks 3001 if 3000 is busy
    env:
      PUBLIC_URL: ${apps.statusphere.url}
      HANDLE_RESOLVER_URL: ${pds.main.url}
      TAP_URL: ${services.tap.url}
```

`PUBLIC_URL` makes the app use an https client ID, `https://statusphere.app.local.snowglobe.at/oauth-client-metadata.json`.
A PDS in Docker will not fetch a loopback client ID (`http://127.0.0.1:3000`), which is the one the app
uses without it. `HANDLE_RESOLVER_URL` is the change below. `services.tap` turns Tap on and tells it to send
the app the events of `xyz.statusphere.status` at the app's `/api/webhook`; the app reads Tap at `TAP_URL`
(`http://127.0.0.1:2480`, on loopback; `SG_TAP_PORT` changes the port). `snowglobe check` refuses a webhook
that names an app the file does not have.

## Two changes to the app

Run `snowglobe up`, then in a clone of the app:

```diff
--- a/lib/auth/client.ts
+++ b/lib/auth/client.ts
+const HANDLE_RESOLVER_URL = process.env.HANDLE_RESOLVER_URL;
 ...
   client = new NodeOAuthClient({
     clientMetadata: getClientMetadata(),
+    handleResolver: HANDLE_RESOLVER_URL,
--- a/next.config.ts
+++ b/next.config.ts
-  allowedDevOrigins: ["127.0.0.1"],
+  allowedDevOrigins: [
+    "127.0.0.1",
+    ...(process.env.PUBLIC_URL ? [new URL(process.env.PUBLIC_URL).hostname] : []),
+  ],
```

- **The handle resolver.** The OAuth library looks a handle up with a fetch that refuses loopback
  addresses, and under `snowglobe run` every snowglobe name is one. Pointing it at the PDS, which
  answers for its own handles, avoids that. Nothing else resolves differently: the app reaches
  `plc.directory` under `snowglobe run`, and that name goes to the snowglobe's PLC.
- **The allowed host.** Next's dev server refuses requests for a host it does not know, which leaves
  the page's scripts unloaded and the login button disabled. The app's own name has to be on the list.
  This is a Next dev-server setting, so it applies to any Next app on an app route.

## The key

The app signs its OAuth requests with a key. Its `pnpm gen-key` script failed here with a
package-exports error from its locked dependencies, so make the same kind of key with Node:

```sh
node -e '
const { generateKeyPairSync } = require("crypto");
const j = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
console.log(JSON.stringify({ ...j, kid: String(Date.now()), alg: "ES256", key_ops: ["sign"] }));
' > key.jwk
```

## Run it

```sh
cp env.template .env.local        # in the app; delete the APP_URL line
pnpm install
PRIVATE_KEY="$(cat key.jwk)" snowglobe run pnpm dev
```

If port 3000 is taken on your machine, pick a free one: set it as the app's `local` port in the file and run the app with `PORT=<that port>`.
A snowglobe brought up before `services.tap` was set needs `snowglobe up` again, which recreates Tap.

Open `https://statusphere.app.local.snowglobe.at`, sign in as `alice.local.snowglobe.at` (her password
is `ALICE_PASSWORD` in `<state>/accounts.env`), authorize, and pick an emoji. The record is on her PDS:

```sh
snowglobe run curl -s --cacert ~/.local/share/snowglobe/ca/ca.crt \
  'https://main.local.snowglobe.at/xrpc/com.atproto.repo.listRecords?repo=alice.local.snowglobe.at&collection=xyz.statusphere.status'
```

## The feed

"Recent" fills from [Tap](https://github.com/bluesky-social/indigo/tree/main/cmd/tap). Tap finds an
account when it writes a `xyz.statusphere.status` record, fetches the account's repo, and posts each
event to the app's `/api/webhook`. In a clean snowglobe, alice's and bob's statuses both appeared in the
app's Recent list with their handles. Tap runs in a small DNS container's network, so it reaches the app's
https name and can check a handle ([How it works](../how-it-works.md)).

## What is left

- **A real browser.** The steps ran in headless Chromium inside `snowglobe run`, with certificate
  errors ignored, and the statuses in the feed were written with a password session, not by clicking in
  the app. They have not been run in a browser on your own machine through the [proxy](../browser.md).
- **An account that wrote before Tap started.** Tap finds an account when it writes, so a repo with
  statuses from before Tap started may not show in the feed until it next writes. Whether Tap's resync
  reads such a repo is unchecked.
- **CI.** Nothing runs this page's flow on a change to the snowglobe yet.
- **The key.** The app's `pnpm gen-key` still fails on its locked dependencies, hence the Node command above.
