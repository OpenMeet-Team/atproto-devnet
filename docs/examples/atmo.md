# atmo (the https devnet, with no devnet code in the app)

[atmo](https://github.com/flo-bit/atmo-events) is an events app. It runs on
[the https devnet](../globe.md) as it would on the real network. Its server reaches each PDS
and `plc.directory` at their https names, and the app has no devnet code or test switch. The devnet
knows nothing about atmo, so everything below is made with the devnet's tools. The steps use the
`feat/groups-opensocial` branch of
[tompscanlan/atmo-events](https://github.com/tompscanlan/atmo-events/tree/feat/groups-opensocial),
checked out beside the devnet as `atmo-events/`, and the
[opensocial.group proposal](https://tangled.org/opensocial.group/proposal) beside both as
`opensocial-proposal/`. Start with the https devnet up.

**Lexicons.** Every devnet PDS resolves NSIDs only from the devnet's lexicon authority. atmo's OAuth
scope includes two permission sets, `rsvp.atmo.permissionSet` and `app.bsky.authCreatePosts`. If the
authority does not hold them, the PDS cannot expand the scope and the consent page fails. Copy both
from their real authorities, then publish them, and the proposal's lexicons for groups. From the
devnet checkout, outside `snowglobe run`, because the copy reads the real `plc.directory`:

```bash
mkdir -p data/atmo-lexicons
for nsid in rsvp.atmo.permissionSet app.bsky.authCreatePosts; do
  authority=$(echo "$nsid" | awk -F. '{print $2"."$1}')      # rsvp.atmo.x -> atmo.rsvp
  did=$(dig +short TXT "_lexicon.$authority" | tr -d '"' | sed 's/^did=//')
  pds=$(curl -s "https://plc.directory/$did" |
    jq -r '.service[] | select(.id == "#atproto_pds") | .serviceEndpoint')
  curl -s "$pds/xrpc/com.atproto.repo.getRecord?repo=$did&collection=com.atproto.lexicon.schema&rkey=$nsid" |
    jq '.value | del(."$type")' > "data/atmo-lexicons/$nsid.json"
done
./bin/snowglobe.mjs lexicons data/atmo-lexicons
./bin/snowglobe.mjs lexicons ../opensocial-proposal/lexicons
```

**An account.** `alice.local.snowglobe.at` and `bob.local.snowglobe.at` are already there (see
[Seeded test accounts](../quick-stack.md#seeded-test-accounts)). To use another, make it with
`bin/snowglobe.mjs account` before you start atmo, because `snowglobe run` maps only the handles it knows
when the command starts.

**Configure atmo.** In `atmo-events/apps/web`, after `pnpm install`, write a git-ignored `.env`.
It overrides the vars in `wrangler.jsonc` for `vite dev`. Wrangler reads a `.dev.vars` instead
when one exists, so keep only one of the two:

```
OAUTH_PUBLIC_URL=
GROUP_PDS_SERVICE=https://alpha.local.snowglobe.at
GROUP_HANDLE_DOMAIN=local.snowglobe.at
```

- `OAUTH_PUBLIC_URL=` is empty on purpose. `wrangler.jsonc` sets it to `https://atmo.rsvp`. Empty
  makes atmo use its loopback OAuth client, `http://127.0.0.1:5454`, which needs no keys and no
  public origin.
- `GROUP_PDS_SERVICE` and `GROUP_HANDLE_DOMAIN` name where atmo would create group accounts: the
  alpha, the devnet PDS that serves spaces. Write the domain with no leading dot. atmo adds the dot
  itself, and `.local.snowglobe.at` gives handles like `name..local.snowglobe.at`, which the PDS refuses.

Then create atmo's tables in its local D1 database. Without them, atmo logs
`no such table: groups` when it serves its OAuth client metadata.

```bash
pnpm exec wrangler d1 migrations apply DB --local
```

**Run atmo** under `snowglobe run`, from `atmo-events/apps/web`:

```bash
../../../atproto-devnet/bin/snowglobe.mjs run pnpm dev     # http://127.0.0.1:5454
```

**Use it from a browser.** Set up a browser on your computer as in
[From a browser on your own computer](../browser.md#from-a-browser-on-your-own-computer). Forward port 5454 to
5454 as well, since the loopback client's redirect URI names that port. Open
`http://127.0.0.1:5454` in that browser and sign in as `alice.local.snowglobe.at`, by handle or by DID,
with her password from `data/accounts.env`. atmo sends you to `https://alpha.local.snowglobe.at` to sign in
and approve, then back to atmo, signed in.

| URL | What answers |
| --- | --- |
| `http://127.0.0.1:5454` | atmo |
| `https://alpha.local.snowglobe.at` | the alpha PDS: its sign-in and consent pages, and its xrpc |
| `https://<handle>/.well-known/atproto-did` | the handle's PDS, with the handle's DID |
| `https://plc.directory/<did>` | the devnet's PLC, with the DID document |

**Use it from the shell.** The same names work under `snowglobe run`. curl does not read
`NODE_EXTRA_CA_CERTS`, so give it the CA. From the devnet checkout:

```bash
dn() { ./bin/snowglobe.mjs run curl -s --cacert data/https/ca.crt "$@"; }
dn https://alpha.local.snowglobe.at/xrpc/_health                # {"version":"0.5.32"}
dn https://alice.local.snowglobe.at/.well-known/atproto-did     # alice's DID
did=$(sed -n 's/^ALICE_DID=//p' data/accounts.env)
dn https://plc.directory/$did                            # her DID document, alsoKnownAs at://alice.local.snowglobe.at
dn "https://alpha.local.snowglobe.at/xrpc/com.atproto.repo.listRecords?repo=$did&collection=community.lexicon.calendar.event"
```

The last line lists the events atmo has written to alice's repo.

**Groups: atmo's confidential client.** With the loopback client, atmo's group page says group
creation is not configured. To create and link a group, atmo needs its confidential OAuth client, at
an https origin where the PDS can fetch its client metadata and keys. The devnet gives that origin
with an app route. From the devnet checkout:

```bash
./bin/snowglobe.mjs app atmo 5454                       # https://atmo.devnet.internal -> port 5454
./bin/snowglobe.mjs invite GROUP_PDS_INVITE_CODE ../atmo-events/apps/web/.env
```

Then in `atmo-events/apps/web`, set `OAUTH_PUBLIC_URL=https://atmo.devnet.internal` in `.env`
in place of the empty line, and add a client key. atmo's key script prints the key, so write it
straight into the file:

```bash
printf "CLIENT_ASSERTION_KEY='%s'\n" \
  "$(npx tsx src/lib/atproto/scripts/generate-key.ts 2>/dev/null | tail -1)" >> .env
```

Run atmo where nginx can reach it, still under `snowglobe run`:

```bash
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=atmo.devnet.internal \
HTTPS_RUN_EXTRA_NAMES=mygroup.local.snowglobe.at \
  ../../../atproto-devnet/bin/snowglobe.mjs run pnpm dev --host 172.18.0.1 --port 5454 --strictPort
```

- `--host` replaces the `127.0.0.1` in atmo's `vite.config.ts`. Use the address that
  `host.docker.internal` has inside the containers; here it is the `docker0` address. Check with
  `docker exec <project>-nginx-1 getent hosts host.docker.internal`.
- `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` lets vite answer requests for `atmo.devnet.internal`.
- `HTTPS_RUN_EXTRA_NAMES` maps, for atmo's process, the handle of the group you are about to
  create, since `snowglobe run` reads its names only at start.

Open `https://atmo.devnet.internal` in the browser set up above, or from the network's page at
`https://local.snowglobe.at/`, which links every routed app. The proxy's PAC, or the launch flags' `*.devnet.internal` rule, covers
the name, and only the proxy's port (or 443) needs forwarding. Sign in, then create the group under groups. The form
mints the group's account on the alpha, then has you sign in as the group to link it. The groups
e2e below creates a group the same way on every run, through atmo's own create.

**Sealed, as on a globe.** The `deploy/snowglobe` branch of atmo runs with
`PUBLIC_ATPROTO_SEALED=true`: it refuses to start without its network's addresses and turns off every
public service with no stand-in. The devnet has an https name for each, so the settings mirror a
globe's. Walked on 2026-10-19 from the network's page to atmo and a signed-in session, in Chromium
and Firefox through the proxy, with no request leaving the devnet.

1. Lexicons, from the devnet checkout: the two permission sets above, and the proposal's lexicons
   from its `main` branch. Its `lex-refactor` branch changed `group.opensocial.meta`, and atmo's
   sign-in then fails at the PDS with `Unable to retrieve space declarations`.

   ```bash
   mkdir -p data/proposal-main
   git -C ../opensocial-proposal archive origin/main lexicons | tar -x -C data/proposal-main
   ./bin/snowglobe.mjs lexicons data/proposal-main/lexicons
   ```

   Without `dig`, look up a lexicon authority over DNS-over-HTTPS in the copy loop above:
   `curl -s -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=_lexicon.$authority&type=TXT" | jq -r '.Answer[0].data'`.
2. An account to sign in with, made before atmo starts: `./bin/snowglobe.mjs account <name> <PREFIX>`.
3. Route atmo, then from `atmo-events/apps/web` make its `.env` with its own script (it writes the
   cookie secret and client key and prints neither), and its tables:

   ```bash
   ../../../atproto-devnet/bin/snowglobe.mjs app atmo 5454     # from apps/web; or run it from the devnet checkout
   npx tsx src/lib/atproto/scripts/setup-dev.ts
   pnpm exec wrangler d1 migrations apply DB --local
   ```
4. Add to `.env`:

   ```
   OAUTH_PUBLIC_URL=https://atmo.devnet.internal
   PUBLIC_ATPROTO_SEALED=true
   PUBLIC_ATPROTO_PLC_URL=https://plc.local.snowglobe.at
   PUBLIC_ATPROTO_SLINGSHOT_URL=https://slingshot.local.snowglobe.at
   PUBLIC_ATPROTO_JETSTREAM_URLS=wss://jetstream.local.snowglobe.at
   PUBLIC_ATPROTO_RELAY_URLS=https://relay.local.snowglobe.at
   PUBLIC_ATPROTO_SIGNUP_PDS=https://alpha.local.snowglobe.at
   PUBLIC_ATPROTO_BLOB_URL_TEMPLATE=https://alpha.local.snowglobe.at/xrpc/com.atproto.sync.getBlob?did={did}&cid={cid}
   PUBLIC_NETWORK_NOTICE=Local devnet: not Bluesky, test data only.
   PUBLIC_NETWORK_NOTICE_URL=https://local.snowglobe.at/
   ```

   The image template reaches the alpha's own blobs only; a globe's image service finds any
   account's server.
5. Run it under `snowglobe run`, on every address so nginx can reach it:

   ```bash
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=atmo.devnet.internal \
     ../../../atproto-devnet/bin/snowglobe.mjs run pnpm dev --host 0.0.0.0 --port 5454 --strictPort
   ```

Open `https://local.snowglobe.at/` and follow its atmo link. Signing in sends you to
`https://alpha.local.snowglobe.at` for the password and the consent page, and back to atmo.

**The groups e2e.** It makes its fixtures with the same tools. From the devnet checkout, after the
lexicons above:

```bash
export ACCOUNTS_FILE=$PWD/data/atmo-e2e.env       # the test's logins, kept mode 600
./bin/snowglobe.mjs account e2e-owner E2E_OWNER
./bin/snowglobe.mjs account e2e-admin E2E_ADMIN
./bin/snowglobe.mjs account e2e-outsider E2E_OUTSIDER
./bin/snowglobe.mjs account e2enospaces E2E_NOSPACES regular   # a member on a PDS without spaces
unset ACCOUNTS_FILE
./bin/snowglobe.mjs invite E2E_INVITE_CODE data/atmo-e2e.env   # each run mints its group with one use
# what the test reads: URLs, DIDs, the handle domain and where the secrets are; no secret
{ grep -E '^E2E_[A-Z]+_DID=' data/atmo-e2e.env
  echo "E2E_PDS=$(sed -n 's/^ALPHA_PDS_URL=//p' data/devnet.env)"
  echo "E2E_PLC_URL=$(sed -n 's/^PLC_URL=//p' data/devnet.env)"
  echo "E2E_HANDLE_DOMAIN=$(sed -n 's/^SG_DOMAIN=//p' data/devnet.env)"
  echo "E2E_CREDENTIALS=$PWD/data/atmo-e2e.env"; } > data/atmo-e2e.fixtures.env
```

Then from atmo's `apps/web`, under `snowglobe run`. Start it after the accounts exist, so their handles
are mapped:

```bash
../../../atproto-devnet/bin/snowglobe.mjs run sh -c \
  'set -a; . ../../../atproto-devnet/data/atmo-e2e.fixtures.env; set +a; node scripts/groups-e2e.mjs'
# ...
# SUMMARY: 49 passed, 0 failed
```

The test refuses any host that is not this machine. Under `snowglobe run` the devnet's names resolve to
127.0.0.1, so it admits them. Without `snowglobe run` it refuses them before any login. The test is
`apps/web/scripts/groups-e2e.mjs` on the `feat/groups-opensocial` branch of
[tompscanlan/atmo-events](https://github.com/tompscanlan/atmo-events/tree/feat/groups-opensocial/apps/web/scripts).
