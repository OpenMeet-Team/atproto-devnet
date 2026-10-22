# Statusphere (a draft, not finished)

> **Draft.** Sign-in and posting a status work. The feed of other people's statuses does not yet,
> and the steps have been run once, by hand, in a headless browser. This page is a place to finish
> the example, not a recipe to trust.

[Statusphere](https://github.com/bluesky-social/statusphere-example-app) is the atproto example app:
sign in with a handle, pick an emoji, and the app writes an `xyz.statusphere.status` record to your
account. It is a Next.js app, and it runs on [a snowglobe](../snowglobe.md) with two small changes to
the app. The rest is the snowglobe's own tools.

## The snowglobe

Start from [`snowglobe.default.yml`](../../snowglobe.default.yml) and add the app:

```yaml
apps:
  - name: statusphere
    local: { port: 3000 }          # where `pnpm dev` listens; Next picks 3001 if 3000 is busy
    env:
      PUBLIC_URL: ${apps.statusphere.url}
      HANDLE_RESOLVER_URL: ${pds.main.url}
```

`PUBLIC_URL` makes the app use an https client ID, `https://statusphere.app.local.snowglobe.at/oauth-client-metadata.json`.
A PDS in Docker will not fetch a loopback client ID (`http://127.0.0.1:3000`), which is the one the app
uses without it. `HANDLE_RESOLVER_URL` is the change below.

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

Open `https://statusphere.app.local.snowglobe.at`, sign in as `alice.local.snowglobe.at` (her password
is `ALICE_PASSWORD` in `<state>/accounts.env`), authorize, and pick an emoji. The record is on her PDS:

```sh
snowglobe run curl -s --cacert ~/.local/share/snowglobe/ca/ca.crt \
  'https://main.local.snowglobe.at/xrpc/com.atproto.repo.listRecords?repo=alice.local.snowglobe.at&collection=xyz.statusphere.status'
```

## What is left

- **The feed.** "Recent" fills from [Tap](https://github.com/bluesky-social/indigo/tree/main/cmd/tap),
  which the app reaches at `TAP_URL` and which calls the app's `/api/webhook`. A snowglobe's own Tap
  (`services: { tap: true }`) has no https name and no published port, and the app's
  `docker-compose.yml` starts a Tap for the real network. Giving the app a Tap that follows the
  snowglobe is the open work. Posting works without it: the app saves your own status as it writes it.
- **The handle in the header.** The page shows `@did:plc:...` where a handle should be.
- **A real browser.** The steps ran in headless Chromium inside `snowglobe run`, with certificate
  errors ignored. They have not been run in a browser on your own machine through the
  [proxy](../browser.md).
