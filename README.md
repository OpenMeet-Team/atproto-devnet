# Snowglobe

A self-contained [AT Protocol](https://atproto.com) network for testing and demos, with its own PDS,
PLC directory and Jetstream, and nothing in it reaches Bluesky's network. This repo runs one on your
machine for local development and CI, on Docker Compose, so it works wherever Docker Compose does. [snowglobe.at](https://snowglobe.at) says what Snowglobe is, and lists the globes we host on a
server, such as [lighthouse.snowglobe.at](https://lighthouse.snowglobe.at).

The default stack is one PDS, a PLC directory, Jetstream and Tap. That is enough to create accounts, publish
and read records, and test Jetstream consumers. Optional overlays add a PDS that supports
permissioned spaces, two more PDS builds beside it, a local relay that crawls them all, and https
names with a local CA. There is no AppView and no feed generator.

## Services

`npm run up` starts the services below. In your own project, `docker-compose.yml` alone runs PDS,
PLC, Jetstream, Tap and init, and your project provides Postgres and SMTP (see
[Integrating into your project](#integrating-into-your-project)).

| Service | Image | Default Port | Purpose |
|---------|-------|-------------|---------|
| **PDS** | `ghcr.io/bluesky-social/pds:0.4` | 3000 | Personal Data Server — stores repos, handles auth |
| **PLC** | `itaru2622/bluesky-did-method-plc` | 2582 | DID registry — local resolution, no plc.directory dependency |
| **Jetstream** | `ghcr.io/bluesky-social/jetstream` | 6008 | JSON event stream from PDS firehose |
| **Tap** | `ghcr.io/bluesky-social/indigo/tap` | 2480 | Repo sync + backfill |
| **init** | `alpine:3.20` | — | One-shot: creates invite codes and seeds test accounts |
| **Postgres** | `postgres:16-alpine` | 5433 | The PLC's database (`docker-compose.test.yml`) |
| **MailDev** | `maildev/maildev:latest` | 1081 web, 1026 SMTP | Email for the PDS (`docker-compose.test.yml`) |

The overlays add more services:

- the spaces PDS on port 3010 ([Spaces PDS and unpublished lexicons](#spaces-pds-and-unpublished-lexicons));
- `pds-regular` on 3020 and `pds-prod` on 3030 ([Several PDS builds side by side](#several-pds-builds-side-by-side));
- `relay` on 2470 and a one-shot `relay-init` ([A local relay](#a-local-relay));
- `nginx` on 127.0.0.1:443 ([The https devnet](#the-https-devnet)).

## Install

```bash
npm install -g @openmeet/snowglobe
snowglobe --help
```

Run `snowglobe up` in a folder with a `snowglobe.yml` (or one above it). The installed package is
read-only to snowglobe: everything it makes is in your own data folder (`~/.local/share/snowglobe`,
`XDG_DATA_HOME`, or `%LOCALAPPDATA%\snowglobe` on Windows). It needs Node 20 or newer and Docker.

## Quick start (standalone)

Run the devnet with its own Postgres and MailDev for self-contained testing:

```bash
git clone https://github.com/OpenMeet-Team/snowglobe.git
cd snowglobe
cp .env.example .env
npm install

# Start all services (devnet + test infrastructure)
npm run up

# Run the test suite
npm test

# Stop everything
npm run down
```

The suite checks health, account seeding, record CRUD, Jetstream events, the raw firehose, Tap tracking, and that no service points at Bluesky.

To use it from another project, clone it beside that project as `atproto-devnet` instead, the name
the overlays below expect ([Integrating into your project](#integrating-into-your-project)).

### If a port is already taken

`npm run up` fails with `port is already allocated` when something on your machine already uses one
of the devnet's ports, often 3000. Each port the devnet opens on your machine can be moved in `.env`;
inside Docker the services keep their usual ports, so nothing else changes. For example, to move the
PDS to 3100:

```bash
echo SG_PDS_PORT=3100 >> .env
npm run up
```

The tests read the same `.env`, so `npm test` follows the move. Every setting is in
[Host port mapping](#host-port-mapping).

### The network's page

This stack has no web page. The page that lists the network's services, accounts and live activity
comes with [the https devnet](#the-https-devnet), at `https://local.snowglobe.at/`
([The network's page](#the-networks-page)).

## Upgrading from earlier versions

Changes to the default stack that existing setups will notice:

- **`data/devnet.env` is gone; an app's settings come from `snowglobe env`.** `snowglobe up` no
  longer writes it (and removes an old one). Map the addresses an app needs in `apps[].env` of its
  `snowglobe.yml`, then `eval "$(snowglobe env)"` or `snowglobe run`; see
  [An app's settings](#an-apps-settings-snowglobe-env). Account names in the file must now be
  unique.
- **The repo is `OpenMeet-Team/snowglobe`, and every setting is `SG_*`.** It was
  `OpenMeet-Team/atproto-devnet` until 2026-10-20; GitHub sends the old address here. Projects that
  use it still look for it beside them at `../atproto-devnet`, so clone it under that name. The
  settings that were `DEVNET_*` and `SNOWGLOBE_*` are `SG_*` with the same ending (`DEVNET_BIND` is
  `SG_BIND`, `SNOWGLOBE_FILE` is `SG_FILE`). The old names still work for now, from the environment
  or `.env`: `bin/snowglobe.mjs` warns once and reads them as the new ones, and the plain stack's
  compose files and scripts fall back to them. Files written before (`data/devnet.env`,
  `data/accounts.env`, the rendered globe) are read either way.

- **The https devnet's default domain is `local.snowglobe.at`, not `devnet.test`.** A PDS refuses
  an OAuth client under `.test`, so at `devnet.test` nobody could sign in through a group host or
  PDSls. A globe run from the default file, or from a `snowglobe.yml` that names no domain, moves on
  its next `up`, which stops at the certificates: the CA was made for `devnet.test` and can't vouch
  for the new names. To keep the old name and its accounts, add `domain: devnet.test` to its
  `snowglobe.yml`. To move, run `bin/snowglobe.mjs down -v` (it drops every account), delete
  `data/https/ca.*`, run `up`, and trust the new `ca.crt`. The browser proxy's PAC follows the domain
  by itself; Chrome launch flags have to name the new one. The plain http stack keeps `devnet.test`.

- **The PDS no longer forwards to Bluesky's AppView.** `app.bsky.*` reads and any method the PDS
  doesn't implement now go to `https://appview.invalid` and fail with `502 UpstreamFailure`.
  Bluesky's AppView never indexed devnet accounts, so for those accounts nothing useful is lost.
- **DID resolution works again on current `pds:0.4` pulls.** Since `@atproto/pds` 0.5.34, the PDS
  refuses to resolve DIDs through an `http://` PLC unless SSRF protection is off, and the floating
  `pds:0.4` tag now pulls 0.5.36. Without the fix, `describeRepo`, OAuth and anything else that
  resolves a new DID fails with `Forbidden protocol "http:"`. The PDS now sets
  `PDS_DISABLE_SSRF_PROTECTION=true`, so it can also fetch private addresses, such as an OAuth client's
  metadata on your machine. The default stack still uses http. The
  [https devnet](#the-https-devnet) keeps SSRF protection off too, for another reason: every address
  a PDS fetches from there (nginx, the PLC, your machine) is a private one, and the protected fetch
  refuses private addresses.
- **init reseeds when `data/` is stale.** `data/` outlives `npm run down`. init used to skip seeding
  whenever `data/accounts.json` existed, leaving credentials for accounts that were gone. It now
  checks that the first recorded account exists on the running PDS and reseeds if it doesn't, so
  `data/accounts.env` gets new DIDs and a new invite code.
- **The PDS runs as root.** Release images already did. This lets `SG_PDS_IMAGE` take monorepo
  images, which default to `node`.
- **The https devnet's nginx config is a template now: rerun `bin/snowglobe.mjs up` after pulling.**
  `https/nginx.conf` became `https/nginx.conf.template`, which the nginx image fills in with
  `SG_DOMAIN` when it starts. An nginx container made before the pull still mounts the old file,
  and once the file is gone that container cannot start again (Docker leaves an empty directory in
  its place). `snowglobe up` recreates it on the new mount. Checking out an older version needs the
  same rerun, the other way round. An overlay that mounts its own config over
  `/etc/nginx/conf.d/default.conf` should mount it at `/etc/nginx/templates/default.conf.template`
  instead, and one that replaces nginx's command must keep the image's entrypoint, which writes the
  template out.
- **The https devnet is rendered from a `snowglobe.yml` now, and a running one starts over.**
  `snowglobe up` writes `data/globe/` with `bin/snowglobe.mjs render` (from `SG_FILE`, else
  `snowglobe.default.yml`: the same alpha, regular and prod) and runs that one compose file;
  `docker-compose.https.yml` is gone. Each PDS is its own service on the compose network, named
  `pds-<name>`, so the alpha is `pds-alpha`, not `pds`, and its data volume is `pds-alpha-data`, not
  `pds-data` (`pds-regular-data` and `pds-prod-data` keep their names). On a devnet brought up
  before this, the alpha would start on a new, empty volume while the PLC still holds its accounts'
  DIDs, and the old `pds` container would be left running beside it. So take such a devnet down with
  the previous checkout first, `-v` included, and the next `snowglobe up` starts it fresh. The plain
  http stacks are unchanged.
- **The `scripts/https-*` tools are gone: use `bin/snowglobe.mjs up`, `down` and `run`.** To keep
  the old layout, check out tag `v0.2.0`, the last version that has them. `https-up.sh` is `up`
  (the file can also be its argument, and `up` now seeds the file's `accounts`, `lexicons.publish`
  and `apps`), `https-down.sh` is `down`, which takes
  `-v` and nothing else, and `https-run` is `run`. `run` now maps every name the rendered globe
  answers to, each PDS in the file included, not a fixed three, to `SG_BIND`. `data/devnet.env`
  takes the Jetstream, maildev and proxy ports from `.env` too, as compose does.
- **snowglobe is `bin/snowglobe.mjs` now.** Its code moved from `scripts/` to `lib/`, one file per
  command under `lib/commands/`. `scripts/snowglobe` still runs it, so a script that calls the old
  path keeps working.

## Integrating into your project

Snowglobe is designed to be **composed into** your project's Docker environment using [Docker Compose file stacking](https://docs.docker.com/compose/how-it-works/#merge). Clone it as a sibling directory and layer it with a thin overlay file in your project.

### Prerequisites

Your project needs to provide two things that Snowglobe expects from the network:

1. **PostgreSQL** — PLC stores DIDs here (database name configurable via `SG_DB_NAME`)
2. **SMTP server** — PDS sends email verification through this (e.g., MailDev)

If your project already runs these, reuse them. If not, provide them in your overlay (see Open Social example below).

### The pattern

```
parent/
├── your-project/
│   ├── docker-compose.yml          # Your existing services
│   ├── docker-compose-devnet.yml   # Overlay: bridges devnet into your network
│   └── scripts/
│       ├── devnet-up.sh            # Start everything
│       └── devnet-down.sh          # Stop everything
└── atproto-devnet/                 # This repo (cloned as sibling)
    ├── docker-compose.yml          # PDS, PLC, Jetstream, Tap, init
    └── .env                        # Port configuration
```

The overlay file does three things:

1. **Connects devnet services to your Docker network** so containers can talk to each other
2. **Overrides environment variables** to point devnet at your project's Postgres and SMTP
3. **Points your app at the local devnet** instead of production Bluesky

### Compose file stacking

Stack three files together — your base, the devnet, and your overlay:

```bash
docker compose \
  -f docker-compose.yml \
  -f ../atproto-devnet/docker-compose.yml \
  -f docker-compose-devnet.yml \
  --project-directory . \
  up -d
```

Compose resolves relative paths from your project, because your file comes first. That includes
the devnet's own `./scripts` and `./data`, which the `init` service mounts. So your overlay must
mount them from the devnet checkout:

```yaml
services:
  init:
    volumes:
      - ../atproto-devnet/scripts:/scripts:ro
      - ../atproto-devnet/data:/devnet-data
```

## Real-world examples

### OpenMeet (reuses existing Postgres + MailDev)

OpenMeet's API already runs Postgres and MailDev. The overlay connects devnet services to OpenMeet's network and reuses its infrastructure.

**`docker-compose-devnet.yml`** (overlay):
```yaml
services:
  # Connect PLC to OpenMeet's existing postgres
  plc:
    environment:
      SG_DB_HOST: postgres
      SG_DB_USER: ${DATABASE_USERNAME}
      SG_DB_PASSWORD: ${DATABASE_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - api-network

  # Connect PDS to OpenMeet's existing maildev
  pds:
    environment:
      PDS_EMAIL_SMTP_URL: smtp://maildev:1025
    networks:
      - api-network

  # Join the network
  jetstream:
    networks:
      - api-network
  tap:
    networks:
      - api-network
  init:
    volumes:
      - ../atproto-devnet/scripts:/scripts:ro
      - ../atproto-devnet/data:/devnet-data
    networks:
      - api-network

  # Point the API at the local devnet
  api:
    environment:
      - PDS_URL=http://pds:3000
      - DID_PLC_URL=http://plc:2582

  # Point firehose consumer at local Jetstream
  bsky-firehose-consumer:
    environment:
      - BSKY_FIREHOSE_URL=ws://jetstream:6008/subscribe

networks:
  api-network:
    name: api-network
```

**`scripts/devnet-up.sh`** handles the full lifecycle:
1. Starts all services via compose file stacking
2. Waits for PDS health check
3. Generates a fresh invite code (999,999 uses)
4. Updates `.env` with the invite code
5. Force-recreates the API container to pick up the new code

See the full implementation in [openmeet-api](https://github.com/OpenMeet-Team/openmeet-api): `docker-compose-devnet.yml`, `scripts/devnet-up.sh` and `scripts/devnet-down.sh` on its main branch.

### Open Social (provides its own Postgres + MailDev)

Open Social doesn't have existing Postgres/MailDev services, so its overlay provides them — similar to `docker-compose.test.yml` but tailored to Open Social's needs.

Open Social stacks the files the other way round. Its `scripts/start-test-env.sh` passes the
devnet's `docker-compose.yml` first and its own overlay second, with no `--project-directory`.
Paths then resolve from the devnet checkout, so init finds its scripts. The overlay reaches Open
Social's own files through `OPENSOCIAL_DIR`, which the script exports.

**`docker-compose.devnet.yml`** (overlay):
```yaml
services:
  # Provide postgres for both PLC and Open Social
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${SG_DB_USER:-postgres}
      POSTGRES_PASSWORD: ${SG_DB_PASSWORD:-postgres}
      POSTGRES_DB: ${SG_DB_NAME:-plc}
    volumes:
      - ${OPENSOCIAL_DIR}/scripts/init-opensocial-db.sh:/docker-entrypoint-initdb.d/10-opensocial.sh:ro
    ports:
      - "${SG_POSTGRES_PORT:-5433}:5432"
    networks:
      - atproto-devnet
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${SG_DB_USER:-postgres}"]
      interval: 3s
      timeout: 3s
      retries: 10

  # Provide maildev for PDS email verification
  maildev:
    image: maildev/maildev:latest
    ports:
      - "${SG_MAILDEV_WEB_PORT:-1081}:1080"
      - "${SG_MAILDEV_SMTP_PORT:-1026}:1025"
    networks:
      - atproto-devnet

  # Wire PLC/PDS to our postgres/maildev
  plc:
    depends_on:
      postgres:
        condition: service_healthy
  pds:
    environment:
      PDS_EMAIL_SMTP_URL: smtp://maildev:1025
```

**`.env.devnet`** is checked into git with safe defaults — no secrets to manage:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/opensocial
PDS_URL=http://localhost:4000
PLC_URL=http://localhost:4001
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
COOKIE_SECRET=dev-cookie-secret
```

Open Social also includes a smoke test (`test/devnet-smoke.test.ts`) that creates a community via the API and verifies the ATProto records land on the local PDS.

See the full implementation: [collectivesocial/open-social#18](https://github.com/collectivesocial/open-social/pull/18)

### atmo (the https devnet, with no devnet code in the app)

[atmo](https://github.com/flo-bit/atmo-events) is an events app. It runs on
[the https devnet](#the-https-devnet) as it would on the real network. Its server reaches each PDS
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
[Seeded test accounts](#seeded-test-accounts)). To use another, make it with
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
[From a browser on your own computer](#from-a-browser-on-your-own-computer). Forward port 5454 to
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
./bin/snowglobe.mjs app atmo 5454                       # https://atmo.app.local.snowglobe.at -> port 5454
./bin/snowglobe.mjs invite GROUP_PDS_INVITE_CODE ../atmo-events/apps/web/.env
```

Then in `atmo-events/apps/web`, set `OAUTH_PUBLIC_URL=https://atmo.app.local.snowglobe.at` in `.env`
in place of the empty line, and add a client key. atmo's key script prints the key, so write it
straight into the file:

```bash
printf "CLIENT_ASSERTION_KEY='%s'\n" \
  "$(npx tsx src/lib/atproto/scripts/generate-key.ts 2>/dev/null | tail -1)" >> .env
```

Run atmo where nginx can reach it, still under `snowglobe run`:

```bash
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=atmo.app.local.snowglobe.at \
HTTPS_RUN_EXTRA_NAMES=mygroup.local.snowglobe.at \
  ../../../atproto-devnet/bin/snowglobe.mjs run pnpm dev --host 172.18.0.1 --port 5454 --strictPort
```

- `--host` replaces the `127.0.0.1` in atmo's `vite.config.ts`. Use the address that
  `host.docker.internal` has inside the containers; here it is the `docker0` address. Check with
  `docker exec <project>-nginx-1 getent hosts host.docker.internal`.
- `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` lets vite answer requests for `atmo.app.local.snowglobe.at`.
- `HTTPS_RUN_EXTRA_NAMES` maps, for atmo's process, the handle of the group you are about to
  create, since `snowglobe run` reads its names only at start.

Open `https://atmo.app.local.snowglobe.at` in the browser set up above, or from the network's page at
`https://local.snowglobe.at/`, which links every routed app. Public DNS answers the name with 127.0.0.1, so a browser on this machine needs only the CA. On another machine the proxy's PAC covers
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
   OAUTH_PUBLIC_URL=https://atmo.app.local.snowglobe.at
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
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=atmo.app.local.snowglobe.at \
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
  ./bin/snowglobe.mjs env --dotenv --app atmo | grep -E '^E2E_(PDS|PLC_URL|HANDLE_DOMAIN)='   # mapped in the atmo app's env: in snowglobe.yml
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

## Seeded test accounts

When `SG_SEED_ACCOUNTS=true` (the default), the init container creates two test accounts and writes their credentials to `data/accounts.json` and `data/accounts.env`:

| Account | Handle | Password |
|---------|--------|----------|
| Alice | `alice.devnet.test` | `alice-devnet-pass` |
| Bob | `bob.devnet.test` | `bob-devnet-pass` |

Create additional accounts at any time:

```bash
./scripts/create-account.sh carol.devnet.test
```

It talks to `http://localhost:3000`. On the spaces stacks, set `SG_PDS_URL=http://localhost:3010`.
It needs `curl` and `jq`, and it prints the new password. On the https devnet, use
[`bin/snowglobe.mjs account`](#tools-for-an-app) instead, which needs only Node and prints no
password.

## Choosing a PDS version

`SG_PDS_IMAGE` picks the PDS image, so you can run your app or the test suite against another
release, an unreleased upstream commit, or the spaces alpha:

```bash
npm run down      # fresh volumes: a newer PDS migrates its database, and an older one can't read it
SG_PDS_IMAGE=ghcr.io/bluesky-social/pds:0.4.5037 npm run up && npm test
```

- **Releases:** `ghcr.io/bluesky-social/pds:<version>`, e.g. `0.4.5037`, `beta`, `latest`. The
  default is `0.4`.
- **Upstream commits:** `ghcr.io/bluesky-social/atproto:pds-<full commit sha>`. All of the last 100
  commits on `main` had one (checked 2026-10-05); commits on other branches may not.
- **Spaces alpha:** see the next section.

Both kinds run here. The PDS runs as root because monorepo images default to `node`, which can't
open the root-owned data volume. It also has `PDS_DISABLE_SSRF_PROTECTION` set, because builds that
include upstream `1ff43e6e5` (2026-09-10) resolve DIDs through a fetch that refuses the local PLC's
`http://` URL.

The suite has passed on `pds:0.4` (`0.4.5036`) and `atproto:pds-cea6f5c4a034860c35eda03dbde207f5bdb9387f`
(`0.5.36`).

## Spaces PDS and unpublished lexicons

`docker-compose.spaces.yml` swaps the PDS for the atproto permissioned-spaces alpha
(`com.atproto.space.*`, `com.atproto.simplespace.*`) and lets it resolve lexicons that aren't
published anywhere. That's what you need to test an OAuth `space:` scope naming your own space type,
or an `include:` permission set, before the NSIDs resolve through DNS.

A PDS normally resolves an NSID through a `_lexicon` DNS TXT record. With
`PDS_LEXICON_AUTHORITY_DID` set, it resolves **every** NSID from that one account instead, so the
lexicons your app's scopes name have to be published there as `com.atproto.lexicon.schema` records,
with the NSID as the record key.

Booting takes two passes, because the authority's DID only exists once the PDS is up:

```bash
F="-f docker-compose.yml -f docker-compose.test.yml -f docker-compose.spaces.yml"
docker compose $F up -d --wait
./scripts/lexicon-authority.sh            # prints SG_LEXICON_AUTHORITY_DID=did:plc:...
SG_LEXICON_AUTHORITY_DID=did:plc:... docker compose $F up -d --wait   # whole stack, not just pds
# then putRecord your lexicons into the authority account
```

`npm run down` names only the base files. Stop an overlay stack with the same files you started it
with: `docker compose $F down`, and add `-v` to drop its volumes. This holds for the multi-PDS and
relay stacks below too.

How this differs from the default stack:

- **PDS on 3010, at `http://localhost:3010`.** The authority account lives on this PDS, and its DID
  document's endpoint has to reach the PDS both from inside its container (to resolve lexicons) and
  from the host. `PDS_HOSTNAME=localhost` makes the endpoint `http://localhost:<PDS_PORT>`, so the
  container and host ports must match. `PDS_DEV_MODE` turns off the SSRF protection that would
  refuse a localhost fetch. Override the port with `SG_SPACES_PDS_PORT`.
- **Digest-pinned image.** Set `SG_PDS_IMAGE` to try another spaces build.

Observed on this image (revision `79d6307e`): writes inside a space (`createSpace`, member entries,
records in a space) don't appear on the PDS firehose or on Jetstream; only public repo records do.

## Several PDS builds side by side

`docker-compose.multi-pds.yml`, stacked on the spaces overlay, adds two more PDSes so you can test
how different builds work together. For example: can a member on a regular PDS join a group hosted
on the spaces alpha?

```bash
F="-f docker-compose.yml -f docker-compose.test.yml -f docker-compose.spaces.yml -f docker-compose.multi-pds.yml"
docker compose $F up -d --wait      # then the two-pass authority step from the spaces section
```

| Service | URL | Image setting | Default | Handles |
| --- | --- | --- | --- | --- |
| `pds` | `http://localhost:3010` | `SG_PDS_IMAGE` | spaces alpha `79d6307e` | `.devnet.test` |
| `pds-regular` | `http://localhost:3020` | `SG_PDS_REGULAR_IMAGE` | `pds:0.4.5037` | `.regular.devnet.test` |
| `pds-prod` | `http://localhost:3030` | `SG_PDS_PROD_IMAGE` | `pds:0.4.5009` (by digest) | `.prod.devnet.test` |

Set `SG_PDS_PROD_IMAGE` to whatever your production PDS runs.

Each PDS writes `http://localhost:<port>` into its accounts' DID documents. For one PDS to reach
another's accounts, that URL has to work inside every PDS container as well as on the host, so the
two extra PDSes share the alpha's network namespace (`network_mode: service:pds`). Other containers
reach them as `pds:3020` and `pds:3030`. The extra PDSes don't require invites, and each has its own
service DID, since all three would otherwise be `did:web:localhost`. On their own, Jetstream and Tap
follow only the alpha; add the local relay below to get one stream from all three.

A PDS forwards any XRPC method it doesn't implement (`com.atproto.space.*` on a non-spaces build,
for one) to its AppView with a service-auth token. On a stock build that shows up as `502
UpstreamFailure`, because every devnet PDS points its AppView at `https://appview.invalid` (see
`SG_APPVIEW_URL`).

## A local relay

`docker-compose.relay.yml`, stacked after the multi-PDS overlay, adds a relay that crawls all three
PDSes. Jetstream and Tap read from the relay, which is the shape production has:

```
PDSes --> relay (:2470) --> Jetstream (:6008)
                       \--> Tap (:2480)
```

```bash
F="$F -f docker-compose.relay.yml"
docker compose $F up -d --wait     # builds the relay image the first time
```

`relay-init` registers each PDS through the relay's admin API, because a relay won't accept a
localhost host from a PDS's own `requestCrawl`. The relay and Tap join the PDSes' network namespace,
so the `http://localhost:<port>` URLs in DID documents work for them as well.

**The relay is built locally, not pulled.** Upstream's relay (`ghcr.io/bluesky-social/indigo:relay-<commit>`)
checks every host through an SSRF-safe transport that refuses loopback and private addresses, with
no setting to turn it off. Its admin `requestCrawl` accepts `localhost:<port>`, and the host check
then fails with `unsafe network address`, so the published image can never crawl a devnet PDS.
`relay/Dockerfile` builds the same upstream commit with `relay/allow-private-hosts.patch`, which
adds one opt-in setting, `RELAY_ALLOW_PRIVATE_HOSTS`, and copies the binary into the published
image. The setting covers both places the relay refuses those addresses: the host check, and the
firehose dialer for `wss://` hosts, which [the https devnet](#the-https-devnet) needs because its
PDS names resolve to nginx's private address. Pick another commit with `SG_RELAY_INDIGO_COMMIT`; it needs a published `relay-<commit>`
image, and the patch has to apply.

## The https devnet

The stacks above serve every PDS at `http://localhost:<port>`, so an app has to be told it is on a
devnet before it will sign in there: allow plain http, and ask the devnet PLC instead of
`plc.directory`. The https devnet goes the other way. It is the globe a `snowglobe.yml` describes
(`snowglobe.default.yml` unless you name another; [the file](#the-file-and-the-commands)), which `bin/snowglobe.mjs up`
renders into one compose file (`bin/snowglobe.mjs render`) and brings up. It looks like the real
network, so an app built for the real network runs against it with no devnet code.

It runs on Linux, and on Windows under WSL 2; both are tested with `node scripts/smoke.mjs`
([Test suite](#test-suite)). macOS is not supported yet: nobody working on it has a Mac to test on.
If you have one, please try it and [open an issue](https://github.com/OpenMeet-Team/snowglobe/issues)
with what broke, or that it worked; we'll add Mac support over time.

With the default file:

| Name | Served by |
| --- | --- |
| `alpha.local.snowglobe.at`, `*.local.snowglobe.at` | `pds-alpha`, the spaces alpha (`79d6307e`), and its handles; invites required |
| `regular.local.snowglobe.at`, `*.regular.local.snowglobe.at` | `pds-regular`, a current release, and its handles |
| `prod.local.snowglobe.at`, `*.prod.local.snowglobe.at` | `pds-prod`, the build you run in prod, and its handles |
| `plc.directory` | this stack's own PLC |
| `slingshot.local.snowglobe.at` | `slingshot`, which answers a handle's DID and PDS (below) |
| `plc.local.snowglobe.at`, `relay.local.snowglobe.at`, `jetstream.local.snowglobe.at` | the PLC, the relay and Jetstream, as a globe names them, so an app's browser code reaches them over https too |
| `pdsls.local.snowglobe.at` | `pdsls`, the record browser ([PDSls](https://pds.ls)) for this network (below) |
| `local.snowglobe.at` | nginx itself: the network's page, the one a globe serves at its bare name (below) |
| `<name>.app.local.snowglobe.at` | an app on this machine, at the port `bin/snowglobe.mjs app` recorded for `<name>` |
| `*.<ending>.local.snowglobe.at` | the app that claimed `<ending>` with `bin/snowglobe.mjs app`, for the handles it hands out |

Each PDS in the file is a service of its own, `pds-<name>`, at `<name>.local.snowglobe.at`; the one with
`bare_handles` takes `*.local.snowglobe.at`, and every other its own `*.<name>.local.snowglobe.at`. nginx answers
all of them on `127.0.0.1:443` with one certificate from a local CA. Each PDS's public URL, OAuth
issuer and DID document endpoint is `https://<its name>`, and the relay crawls every PDS as a
`wss://` host. Inside the compose network nginx also answers to every PDS's name, so the PDSes,
the relay and Tap reach each other over TLS; no service shares another's network but Slingshot. On the machine, the names resolve to `127.0.0.1` only for
commands run under `bin/snowglobe.mjs run`, so every other program still reaches the real
`plc.directory`.

`local.snowglobe.at` is the default file's domain, and every name in the table above (and in the
rest of this README) uses it. The name is ours, and its public DNS points every name under it at
`127.0.0.1`, so a lookup that misses the devnet's own mapping lands on your machine, not on someone
else's server. Pick another domain freely, but not one under `.test`, `.local`, `.localhost`,
`.invalid` or `.example`: the stack comes up there, but a PDS refuses an OAuth client at such a name,
so nobody can sign in through a group host or PDSls. `SG_DOMAIN` replaces it. Only the https devnet reads it; the plain stack
keeps `SG_PDS_HOSTNAME` and `SG_HANDLE_DOMAIN`. Set it in the environment or in `.env` and
the same stack comes up under that domain: `alpha.<domain>` with handles at `<name>.<domain>`,
`regular.<domain>`, `prod.<domain>`. `plc.directory` stays as it is; apps follow the domain, at `<name>.app.<domain>`.
In `.env`, write the domain itself (quotes, `export` and a trailing comment are fine); the scripts
refuse a `${...}` there, which compose would expand and they would not. A checkout keeps one domain,
because its CA can vouch only for the domain it was made for ([The CA](#the-ca)); for a second
domain, use a second checkout.

The devnet knows no app. It has no app's accounts, invite codes, lexicons or ports. It gives an app
tools to make its own (below), and using them is optional.

### Slingshot: handles and DIDs inside the network

`slingshot` is [Slingshot](https://tangled.org/jola.dev/microcosm-rs/tree/main/slingshot) from
microcosm-rs, built from a pinned commit (`slingshot/Dockerfile`; upstream publishes no image), set
to this stack's PLC and this stack's Jetstream. The public Slingshot cannot see a devnet account;
this one answers for it:

```sh
bin/snowglobe.mjs run curl -sS --cacert data/https/ca.crt \
  'https://slingshot.local.snowglobe.at/xrpc/com.bad-example.identity.resolveMiniDoc?identifier=alice.local.snowglobe.at'
# {"did":"did:plc:...","handle":"alice.local.snowglobe.at","pds":"https://alpha.local.snowglobe.at","signing_key":"zQ3..."}
```

It checks a handle both ways, which means it fetches `https://<handle>/.well-known/atproto-did`
from inside the compose network, and a handle's name exists nowhere but in nginx. So it runs in
the network namespace of `slingshot-dns`, a dnsmasq
that answers nginx's address for any name under `SG_DOMAIN` and nothing else, and its only
root is the devnet CA. nginx reaches it as `slingshot-dns:8080`. `slingshot` is a name, not a
handle: `snowglobe account` refuses it. To recreate `slingshot-dns`, recreate `slingshot` with it.
To build another Slingshot, set `SG_SLINGSHOT_COMMIT` to a full microcosm-rs commit; it picks
the source and names the image.

### The network's page

`https://local.snowglobe.at/` is the network's own page (`page/index.html`): every service and its
health, every account on each PDS, the apps `snowglobe app` routed, and the network's writes
from Jetstream, the last week's and then live. nginx serves it with this stack's relays (`page/devnet.conf`), a fixed GET-only path per read, so the page
asks nothing but `local.snowglobe.at`. `snowglobe render` and `snowglobe app` write what it lists into
`data/https/nginx/globe.json`. Open it from a browser set up as in [From a browser on your own
computer](#from-a-browser-on-your-own-computer), or `bin/snowglobe.mjs run curl -s https://local.snowglobe.at/globe.json`.

### PDSls: browsing the network's records

`https://pdsls.local.snowglobe.at/` is [PDSls](https://github.com/notjuliet/pdsls), the record browser at
pds.ls, for this network: `https://pdsls.local.snowglobe.at/at://alice.local.snowglobe.at` shows her repo, its
collections and records, as `https://pds.ls/at://...` does on the real network. Apps that link to
pds.ls point their links here on a devnet or a globe. `pdsls/` builds it from a pinned upstream commit
with `pdsls/network.patch`, which lets the page that loads it give it a network's addresses (unset,
it is the public network's, unchanged), and `pdsls/server.mjs` serves it with this network's: the PLC
at `plc.local.snowglobe.at`, Jetstream and the relay as the stream page's defaults, and the lexicon authority
for every NSID. It looks up handles and `did:web` documents for names under `local.snowglobe.at` only, and
turns off what has no stand-in here: DNS lookups, Bluesky search and avatars, backlinks, Spacedust,
the public font host, link previews. Signing in uses a client at its own address, so editing records
works against the devnet's PDSes.

A record's Schema tab shows its lexicon when the authority holds it and pdsls's parser accepts it.
Measured 2026-10-19: the opensocial proposal's lexicons (a `space` definition, a `space-ref` format)
and atmo's permission set fail that parser, as they would on pds.ls; the record view is unaffected.

### The file and the commands

One file says what a globe runs: `snowglobe.yml`. It belongs in an app's repo, next to the lexicons
it publishes, and is committed. Everything the globe makes while it runs (the CA's key, passwords,
invite codes, app routes) goes under this checkout's `data/`, which is git-ignored and never
committed ([What it writes](#what-it-writes)).

```yaml
globe: bookclub                  # lowercase letters and digits; the globe's own name
domain: local.snowglobe.at       # every name below is under it (local.snowglobe.at if left out)

pds:                             # at least one; each is pds-<name> at https://<name>.<domain>
  - name: alpha
    image: spaces-alpha          # a short name (pinned by digest), or any image reference
    bare_handles: true           # handles <name>.<domain>; at most one PDS. Others: <name>.<pds>.<domain>
    invites: required            # open (default) or required
  - name: regular
    image: ghcr.io/bluesky-social/pds:0.4.5037

grouphosts:                      # optional; each is grouphost-<name> at https://<name>.<domain>
  - name: gh                     # its groups' handles are <group>.gh.<domain>
    kind: opensocial             # atproto-group-host, the only kind so far
    build: ../atproto-group-host # a folder with a Dockerfile, from this file's folder; or image:

services:                        # each true or false; these are the defaults
  relay: auto                    # auto: on when there is more than one PDS
  jetstream: true
  tap: true
  slingshot: true                # needs jetstream
  pdsls: true

lexicons:
  authority: alpha               # the PDS lex-authority is made on (the bare-handle PDS by default)
  publish: lexicons              # a folder next to this file; up publishes every lexicon in it

accounts:                        # <name>@<pds>; up makes each one
  - owner@alpha
  - reader@regular

apps:
  - name: bookclub
    local: { port: 5173, handles: bc }   # https://bookclub.app.<domain> and handles *.bc.<domain>
```

`bin/snowglobe.mjs check` says what is wrong with a file, one line per problem, and touches
nothing. A name used twice, a PDS named like a service, an app's handle ending that is a PDS's
name, a handle longer than DNS allows: each fails here, before anything starts. `hosted` and an
app's `hosted` are read and checked, for a globe hosted on the cluster; a local globe does not use
them.

**Group hosts** are optional. Each one runs beside the PDSes as a service of its own at
`https://<name>.<domain>`, with every group's handle under `<name>.<domain>`; nginx, the
certificate and the network page (its health, and its groups under accounts) get each one, as they
get each PDS. The one kind, `opensocial`, is
atproto-group-host, which is not public yet and publishes no image,
so `up` builds it from a checkout with the repo's own Dockerfile, on every run (Docker's cache keeps
an unchanged one quick). The checkout is the group host's `build` folder in the file, else
`SG_OPENSOCIAL_BUILD` (a path from where you run the command), so a file shared between
machines can leave it out:

```bash
SG_OPENSOCIAL_BUILD=../atproto-group-host bin/snowglobe.mjs up ../myapp/snowglobe.yml
```

`image:` in place of `build` runs a built image instead. With neither, and the variable unset,
`render` and `up` stop before anything changes and say so. A group host makes its groups' accounts
itself, takes no invite code, and resolves every name under the domain through nginx, its members'
handles too. Under `snowglobe run`, list a group's handle in `HTTPS_RUN_EXTRA_NAMES`, as for any
handle.

`up` seeds what the file asks for, every run, and a rerun changes nothing that is already there:

- **accounts**: each one is made with `snowglobe account` (below). Its login goes to
  `data/accounts.env` as `<NAME>_*` on the PDS with bare handles (else the first), where init's
  `alice` and `bob` are, so `alice@alpha` is init's own alice; on any other PDS as
  `<NAME>_<PDS>_*`, so `reader@regular` is `READER_REGULAR_*`. Passwords are generated and never
  printed.
- **lexicons.publish**: every lexicon in the folder, at any depth, goes into the authority as
  `snowglobe lexicons` does; an unchanged one is left alone, and other JSON is skipped.
- **apps[].local**: the route `snowglobe app <name> <port> [<handles>]` would make, set before the
  certificate and nginx, so both have it. A route made by hand with `snowglobe app` stays.

The commands, each `bin/snowglobe.mjs <command>`:

| Command | What it does |
| --- | --- |
| `check [<file>]` | checks a file |
| `render [<file>]` | writes the globe it describes into `data/globe/` (`up` does this itself) |
| `certs [--check]` | makes the CA and the leaf nginx serves (`up` does this itself) |
| `up [<file>]` | brings the globe up as `SG_PROJECT` and seeds it ([Up and down](#up-and-down)) |
| `down [-v]` | stops it; `-v` drops its volumes too |
| `run [--] <cmd>` | runs a command that reaches the globe at the real network's names (Linux) |
| `account`, `invite`, `lexicons`, `app` | make an app's own accounts, invite codes, lexicons and routes ([Tools for an app](#tools-for-an-app)) |

With no `<file>`, `up` reads `SG_FILE` if it is set; past that, each command reads
`./snowglobe.yml` in the folder it runs in if there is one, else `snowglobe.default.yml` here:
alpha, regular and prod, with `alice` and `bob`. Exit 2 means
the command was called wrong, 1 that the globe refused, 3 that `up` or `down` refused the shared
devnet.

### Up and down

Every run names its compose project with `SG_PROJECT`; there is no default. The scripts refuse
the shared project `devnet-spaces` unless `SG_RESET_OK=1`, and exit before calling docker.

```bash
export SG_PROJECT=devnet-mine
bin/snowglobe.mjs up      # certificates, two-pass authority boot
bin/snowglobe.mjs down    # stop it; -v also drops its volumes (every account and DID)
```

Both run the one compose file `snowglobe up` last rendered, from the repo root:

```bash
bin/snowglobe.mjs up ../myapp/snowglobe.yml   # another globe than the default (or SG_FILE)
docker compose -p "$SG_PROJECT" --project-directory . -f data/globe/compose.yml ps
```

`snowglobe up` is safe to rerun; a rerun leaves the running services as they are, and only the
one-shot `init` and `relay-init` run again. A rerun on a changed file stops what the file no longer
runs, and when it adds a PDS beside a running relay it restarts the relay, which otherwise can wait
a long time before it redials a PDS that went away and came back. It refuses a PDS named for a handle ending an app
claimed with `snowglobe app`, before it writes anything. It makes the leaf certificate if there is
none, brings the stack up, makes the lexicon authority (`lex-authority.local.snowglobe.at` on the file's
`lexicons.authority` PDS, the alpha by default),
brings the stack up again with `SG_LEXICON_AUTHORITY_DID` so every PDS starts with it. It writes no
settings file for an app: `snowglobe env` prints them. The base init still seeds `alice` and `bob` and a 100-use `SG_INVITE_CODE`
into `data/accounts.env`, on the PDS with bare handles (else the first), as it does for the http
stacks. Nothing else is seeded.

Published ports, all on `127.0.0.1` only: 443 (nginx), the PLC (`SG_PLC_PORT`), Jetstream
(`SG_JETSTREAM_PORT`, `SG_JETSTREAM_METRICS_PORT`) and maildev (`SG_MAILDEV_WEB_PORT`,
`SG_MAILDEV_SMTP_PORT`). Set those to run a second https devnet beside another; pass the same
values on every run. The PDS, relay, Tap and Postgres ports are not published: reach a PDS by its
https name. nginx needs port 443 itself, so a second https devnet also takes another loopback
address, `SG_BIND` (for example `127.0.0.2`; the default is `127.0.0.1`). Set it in the
environment or `.env`; the scripts read it as compose does, and `snowglobe run` maps the names to it. The scripts refuse anything but a `127.x.y.z` address: the devnet's
logins are throwaway, so it is never published beyond this machine.

`snowglobe down` runs `docker compose down` (with `-v` when given) and never deletes `data/`. The PLC's
database is a named volume (`plc-db`), so a `down` without `-v` keeps every DID along with the
PDSes. After `-v`, the next `snowglobe up` starts over: init reseeds `alice` and `bob` and rewrites
`data/accounts.env` from scratch, so the logins the tools wrote there are gone along with their
accounts (run `snowglobe account` and `snowglobe invite` again), and the authority is made again with
a new DID.

### What it writes

`data/` is git-ignored:

- No `data/devnet.env`: `snowglobe up` stopped writing it (and removes an old one). The addresses it
  held come from `snowglobe env`, see "An app's settings" below.
- `data/accounts.env` (mode 600): logins. `SG_INVITE_CODE`, `ALICE_*` and `BOB_*` from init,
  `LEX_AUTHORITY_*`, and whatever the tools below add.
- `data/globe/`: the rendered globe, nothing secret. `compose.yml`, `nginx/` (each PDS's and
  group host's server and the page's relays to it), `leaf-names` and `globe.env` (the facts the scripts read).
  `snowglobe up` writes it again on every run; `bin/snowglobe.mjs render` writes it alone.
- `data/https/`: `ca.crt` and `ca.key` (the CA), `leaf.crt` and `leaf.key` (what nginx serves),
  `names` (the handles `snowglobe run` maps), `apps` and `nginx/` (the app routes and the page's
  `globe.json`), and `hosts` (the
  hosts file `snowglobe run` last generated).

### Running a command against it: `snowglobe run`

```bash
bin/snowglobe.mjs run getent hosts plc.directory     # 127.0.0.1 inside; the real address outside
(cd ../bookclub && ../atproto-devnet/bin/snowglobe.mjs run npm run dev)
```

`snowglobe run <cmd>` runs the command with two changes, for its process tree only:

- the globe's names (its page, every PDS, its services and `plc.directory`, as the rendered globe
  lists them), every handle in `data/https/names` and every app in `data/https/apps` (as
  `<name>.app.<domain>`) resolve to `SG_BIND` (`127.0.0.1` by default).
  [bubblewrap](https://github.com/containers/bubblewrap) gives the command its own mount namespace,
  with a generated hosts file bound over `/etc/hosts`. Same filesystem, network and user otherwise.
  `HTTPS_RUN_EXTRA_NAMES` adds names.
- Node trusts the devnet CA on top of its own roots (`NODE_EXTRA_CA_CERTS=data/https/ca.crt`).
  Miniflare's source passes the same file to workerd, so a Worker's `fetch` should trust it too.

The names are read when the command starts. Handles are listed one by one (there is no wildcard
DNS), so restart a command under `snowglobe run` to pick up a handle or app made after it started.
Node's certificate checks stay on: `snowglobe run` only adds a CA for them to trust. It needs Linux
and bubblewrap; on a Mac it says so and exits, and an app there is handed its settings with
`eval "$(snowglobe env)"` instead.

### An app's settings: `snowglobe env`

An app is handed the snowglobe's addresses as settings; nothing stands in for Bluesky's names. The
mapping is `apps[].env` in `snowglobe.yml`, from the setting's name to a value that may hold
`${name}` placeholders (`$$` is a literal `$`). Quote a value that starts with `${` inside `{ }`;
in a block map it needs none.

```yaml
apps:
  - name: atmo
    local: { port: 5173 }
    env:
      PUBLIC_ATPROTO_PLC_URL: ${services.plc.url}
      PUBLIC_ATPROTO_JETSTREAM_URLS: ${services.jetstream.ws}
      PUBLIC_ATPROTO_SIGNUP_PDS: ${pds.alpha.url}
      E2E_CREDENTIALS: ${accounts.file}
```

```bash
eval "$(snowglobe env)"            # export NAME='value' lines, and NODE_EXTRA_CA_CERTS
snowglobe env --dotenv > .env.local   # NAME=value, for a framework's own file
snowglobe run npm run dev          # the same settings, passwords included, for that command
```

With one app in the file `env` and `run` use it; with several, name it with `--app <name>`; with
none, only `NODE_EXTRA_CA_CERTS` is set. `env` leaves out a password
(`accounts.<name>.password`) and prints a comment naming it; `--secrets` includes it, and `run`
always does, printing none. `--dotenv` quotes for dotenv and Vite, and refuses (naming the setting) a value
with a `$` that starts a name, since Vite would expand it; use the `export` form for that one. A setting `run` hands over replaces the same name already in the
environment, and `run` prints one line naming the ones it replaced.

The names follow the file: the section, the name you gave it, then the field. Every server has
`.url` (`https://<host>`) and `.host`:

| Name | Value |
|---|---|
| `domain`, `globe`, `page.url` | the file's domain and globe name; `https://<domain>/` |
| `pds.<name>.url` `.host` `.did` | `https://<name>.<domain>`, the host, `did:web:<host>` |
| `grouphosts.<name>.url` `.host` `.did` | the same, for a group host |
| `apps.<name>.url` `.host` | `https://<name>.app.<domain>` |
| `services.plc.url` | `https://plc.<domain>` |
| `services.relay` `.jetstream` `.url` `.ws` | `https://relay.<domain>`, `wss://relay.<domain>`; Jetstream's `.ws` ends in `/subscribe` |
| `services.slingshot.url`, `services.pdsls.url` | `https://slingshot.<domain>`, `https://pdsls.<domain>` |
| `accounts.<name>.handle` `.pds` | the handle, and its PDS's url |
| `lexicons.authority.handle` | the authority account's handle |
| `services.mail.url`, `accounts.<name>.did` `.password`, `accounts.file`, `lexicons.authority.did`, `ca.file` | known after `snowglobe up`, read from its state |

`snowglobe check` reads the names with the rest of the file: a misspelled one is an error at
`apps[0].env.<NAME>` that lists what exists ("pds.nope is not a PDS in this file: alpha, regular,
prod"), and so is the address of a service the file turns off. Account names must be unique in the
file. The `plc.directory` stand-in `run` makes is unchanged.

### Tools for an app

Each example uses a made-up app, `bookclub`. None of them prints a secret; a login or code goes only
to the file named.

**An account**, on any PDS in the globe: `bin/snowglobe.mjs account <name> <PREFIX> [<pds>]`.

```bash
bin/snowglobe.mjs account bookclubowner BOOKCLUB_OWNER            # bookclubowner.local.snowglobe.at on the alpha
bin/snowglobe.mjs account bookreader BOOKCLUB_READER regular      # bookreader.regular.local.snowglobe.at
```

Without `<pds>` it uses the PDS with `bare_handles`, else the first. It prints the DID alone, and a
rerun finds the account instead of making another. The login goes to `ACCOUNTS_FILE` (default
`data/accounts.env`, mode 600) as `<PREFIX>_HANDLE`, `_DID`, `_PASSWORD` and `_PDS`, and the
handle goes to `data/https/names`. A PDS with `invites: required` is sent `SG_INVITE_CODE` if it
is set, else a single-use code minted for the account; the others are sent none. On the PDS with
bare handles, a name the globe uses itself (a PDS's, a service's, an app's handle ending) is
refused, because the handle would be that name.

**An invite code**, for an app that creates accounts itself:
`bin/snowglobe.mjs invite <VAR> [file] [--pds <pds>]`.

```bash
bin/snowglobe.mjs invite BOOKCLUB_INVITE_CODE ../bookclub/.env.devnet
```

It mints the code through the PDS's admin API (`INVITE_USES`, default 100) and writes
`<VAR>=<code>` to the file (default `data/accounts.env`, mode 600), replacing an earlier line. The
PDS is the one with `invites: required`; name it with `--pds` when the globe has more than one.

**Lexicons.** With `PDS_LEXICON_AUTHORITY_DID` set, every devnet PDS resolves **every** NSID from
the authority account, never from DNS, so an app's record types, permission sets and space types
have to be published there as `com.atproto.lexicon.schema` records, keyed by NSID. An app publishes
its own:

```bash
bin/snowglobe.mjs lexicons ../bookclub/lexicons    # prints each NSID: com.example.bookclub.review, ...
```

It publishes every lexicon JSON under the folder, at any depth, and leaves a record alone when it
already holds the same document. Or publish with the app's own tooling: sign in with the
`LEX_AUTHORITY_*` login in `data/accounts.env` and `putRecord` each document into
`com.atproto.lexicon.schema` with the NSID as the record key.

**An app route**, so the app has an https origin that both the PDSes and `snowglobe run`'s processes
reach: `bin/snowglobe.mjs app <name> <port>`.

```bash
bin/snowglobe.mjs app bookclub 5600     # https://bookclub.app.local.snowglobe.at -> port 5600 on this machine
```

The app must listen where Docker's host gateway lands (`host.docker.internal` inside the
containers; the `docker0` address here), or on `0.0.0.0`. The route is kept in `data/https/apps` (a
rerun with the same name changes the port), and nginx in `SG_PROJECT`'s stack is reloaded.
`bin/snowglobe.mjs app --remove bookclub` drops the route the same way, and the app comes off the
network page. A
name under `app.<domain>` with no route gets a 404 from nginx and reaches nothing. A confidential
OAuth client can use `https://bookclub.app.local.snowglobe.at/...` as its client_id: the PDS fetches its
metadata and keys from there over TLS. A client_id under `.test` is refused by the PDS
(`invalid_client_id: The client_id's TLD must not be a local hostname`), which is why apps live under
`app.<domain>`, a name that is not local.

**A handle ending**, for an app that hands out handles of its own, as a PDS does. A third word
claims one:

```bash
bin/snowglobe.mjs app grouphost 7070 gh  # also https://<handle>.gh.local.snowglobe.at -> port 7070
```

nginx then sends every name under `gh.local.snowglobe.at` to the app, Host and all, so the app answers
`/.well-known/atproto-did` for its handles and they resolve from anywhere on the devnet. The leaf
gains `*.gh.local.snowglobe.at` from the same CA, so nothing has to be trusted again. `alpha`, `regular` and
`prod` belong to the PDSes, and an ending belongs to one app. A rerun without the ending drops it.
Under `snowglobe run`, list each such handle in `HTTPS_RUN_EXTRA_NAMES`, as for any handle.

`scripts/https-probe.mjs` checks the whole path for any app name. It resolves an account through
`https://plc.directory` with stock atcute at its defaults, serves a confidential client at
`https://<PROBE_APP>.app.<domain>/`, pushes a PAR with that client_id, and pushes a raw PAR with a
`.test` client_id, which the PDS refuses. `ATCUTE_DIR` is required: a directory node resolves
`@atcute/oauth-node-client` and `@atcute/identity-resolver` from.

```bash
bin/snowglobe.mjs app probe 5480
ATCUTE_DIR=<dir> PROBE_DID=<did> bin/snowglobe.mjs run node scripts/https-probe.mjs
```

```
RESOLVED did:plc:... on https://alpha.local.snowglobe.at through plc.directory, ... off
PAR ACCEPTED for confidential client https://probe.app.local.snowglobe.at/probe-<run>/oauth-client-metadata.json
REFUSED .test client_id: HTTP 400 invalid_client_id: The client_id's TLD must not be a local hostname
```

### How it differs from the http stacks

- **Each PDS at its https name.** `PDS_HOSTNAME` is `alpha.local.snowglobe.at`, `regular.local.snowglobe.at` or
  `prod.local.snowglobe.at`, and the alpha's handle domain is set to `.local.snowglobe.at` explicitly (its default
  would be `.alpha.local.snowglobe.at`). The alpha runs with `PDS_DEV_MODE=false`, as it would on the
  real network; the two releases keep dev mode on. All three keep `PDS_DISABLE_SSRF_PROTECTION`, because everything
  they fetch here sits on an RFC 1918 address.
- **The PDSes reach each other over TLS.** Inside the compose network, nginx also answers to the
  three PDS names, and each PDS trusts the CA through `NODE_EXTRA_CA_CERTS`. Docker's DNS has no
  wildcard names, so each PDS preloads `https/app-names.cjs`, which looks up any name under `app.<domain>`
  (the app names) as nginx; inside a container public DNS's 127.0.0.1 is the container itself. Only the address changes: the request keeps the app's name, and TLS still checks the
  certificate for it.
- **nginx routes by name.** Each PDS's block takes its name and its handle wildcard, and passes Host
  through, so the PDS answers `/.well-known/atproto-did` for a handle. Of two matching wildcards nginx
  takes the longer, so `*.regular.local.snowglobe.at` wins over `*.local.snowglobe.at`. A name nginx does not list
  gets no certificate at all.
- **The relay dials wss.** `relay-init` registers the three bare names, which the relay treats as
  https hosts. Their addresses are nginx's, a private one, so the relay is built with
  `relay/allow-private-hosts.patch`, whose `RELAY_ALLOW_PRIVATE_HOSTS` covers the firehose dialer as
  well as the host check (see [A local relay](#a-local-relay)). The CA is mounted into
  `/etc/ssl/certs`, which Go reads on top of its bundle. `RELAY_ALLOW_INSECURE_HOSTS` is dropped. The
  image has its own tag, `atproto-devnet-relay:https-<commit>`. The relay's `listHosts` shows a host
  only once it has sent an event.
- **Tap resync is not supported.** Tap follows the relay's stream, but it fetches a repo to resync
  through an SSRF-safe transport that refuses nginx's address, so a resync fails here.
- **Jetstream is unchanged**, at `ws://127.0.0.1:<SG_JETSTREAM_PORT>`, reading the relay over the
  compose network.

### The CA

`bin/snowglobe.mjs certs` makes the CA once, in Node (no openssl needed). `snowglobe up` runs it
when there is no leaf, or when the leaf lacks a name. Rerunning it keeps the CA and reissues the
leaf only when it lacks a name, so a browser or OS that trusts `ca.crt` keeps trusting the devnet.
A CA made by the old `scripts/https-ca.sh` is kept the same way. `bin/snowglobe.mjs certs --check`
only says whether the leaf lacks a name (exit 1) or not (exit 0). The leaf names what the render lists in
`data/globe/leaf-names`: `local.snowglobe.at` itself, each PDS and its handles (`*.local.snowglobe.at` for the one
with bare handles, `*.<name>.local.snowglobe.at` for each other), each group host and its groups' handles,
`plc.`, `relay.`, `jetstream.`,
`slingshot.` and `pdsls.local.snowglobe.at`, `plc.directory` and `*.app.local.snowglobe.at` (the apps); and
`*.<ending>.local.snowglobe.at` for each handle ending an app claimed. A TLS wildcard covers one label, so
each handle domain needs its own. `snowglobe app` reissues the leaf
when it claims an ending, and `snowglobe up` when the leaf lacks any of these names. Add deeper names
with `HTTPS_EXTRA_NAMES="x.mine.local.snowglobe.at"` on every run, then restart nginx. A name one label
under `local.snowglobe.at` is already covered. To start over, delete `data/https/ca.*` and trust the new
`ca.crt` wherever the old one was trusted.

The CA can only vouch for servers under `local.snowglobe.at` (the `SG_DOMAIN` it was made for)
and `plc.directory` (name constraints, server auth only, no IP addresses), so trusting it puts no other site at risk, even if
`data/https/ca.key` leaks. Keep that file on the dev machine, and remove the CA from a browser or OS
when you're done with it: `bin/snowglobe.mjs trust --remove`. On Windows by hand:
`certutil -user -delstore Root "<its name>"`, the name being the CN that `bin/snowglobe.mjs certs`
prints ("Keeping the existing CA: ...").

Each CA made since 2026-10-19 has a name of its own, `atproto-devnet local CA <date> <hex>`; older
ones are all `atproto-devnet local CA`. Two CAs with one name break each other: a browser that trusts
one checks the other's certificates against the wrong key and rejects them as a bad signature, which
it will not let you click through. So a second checkout's devnet, with a CA of its own, gets an
ordinary unknown-issuer warning instead, until its CA is trusted too.

### From a browser on your own computer

nginx runs in the dev container, so a browser on your own computer needs two things: a way to send
the devnet's names to it, and trust in the devnet's CA. The proxy below does the first with a
setting you make once, in the browser you already use. Launch flags (further down) are the older way.

#### Through the devnet's proxy (Chrome, Edge, Firefox)

The `proxy` service (`https/proxy/server.mjs`) is a proxy and the PAC file that points at it, on one
port, `127.0.0.1:1080` (`SG_PROXY_PORT`). The PAC names it as an HTTP proxy, which every PAC
reader understands, Windows' own included; it also answers SOCKS5, for a client set to it directly. The PAC sends `local.snowglobe.at` and `*.local.snowglobe.at` (apps included) to the proxy and everything else direct, so the rest of your browsing is
untouched. The browser hands the proxy the name, and the proxy connects every devnet name to nginx,
so a handle made a second ago works with nothing to update. It refuses any other name, any IP
address and any port but 443.

**Once per computer:**

1. **Trust the snowglobe's CA** (more in [The CA](#the-ca)). On the machine whose browser you use:
   `bin/snowglobe.mjs trust`. It puts your CA (`<state>/ca/ca.crt`, one per user) in the system
   store and in the NSS databases Chrome, Edge and Firefox read on Linux, or in the login keychain
   on macOS (not yet tried on a Mac) or the user store on Windows. It prints every command, marks
   the ones that need sudo, and does nothing the second time. On WSL it also prints the PowerShell
   step for the Windows store. `trust --dry-run` shows what it would do; `trust --remove` undoes it.

   If the snowglobe runs on another machine (a dev container), copy its `ca.crt` over and trust it
   there by hand:
   - Windows, for Chrome, Edge and Firefox: `certutil -user -addstore Root ca.crt` (no admin; Windows
     asks you to confirm). Firefox reads the Windows store: a Firefox on Windows set up this way
     found the trusted CA on 2026-10-19.
   - macOS, for Chrome, Edge and Safari:
     `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ca.crt`.
     Firefox: Settings, Privacy & Security, View Certificates, Authorities, Import.
   - Linux: Chrome and Edge read `~/.pki/nssdb`:
     `certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n snowglobe -i ca.crt` (from `libnss3-tools`).
     Firefox: import it as on macOS.

   Without this step the proxy still works, but each devnet name gets a certificate warning you click
   through once, and an app's own calls from the page to a PDS fail where no one can click.
2. **Forward the proxy's port.** In VS Code's Ports view, forward port 1080 of the dev container
   (`SG_PROXY_PORT`, if you set one). Any local port will do: the PAC names the address it was
   fetched from. The proxy asks no one to sign in, so whoever can reach the forwarded port reaches
   the whole devnet: every PDS, the PLC, the network page, and every app of yours routed with
   `snowglobe app`, each behind only its own sign-in. Keep the forwarded port on your computer's
   loopback address and don't open it to a network.
3. **Point the browser at the PAC**, `http://127.0.0.1:1080/proxy.pac` (the forwarded port):
   - Windows, for Chrome, Edge and Firefox: Settings, Network & internet, Proxy, "Use setup script",
     with the URL as the script address.
   - macOS: System Settings, Network, your connection, Details, Proxies, "Automatic proxy
     configuration", with the URL.
   - Linux (GNOME): Settings, Network, Network Proxy, Automatic, with the URL.
   - Firefox: Settings, Network Settings, "Use system proxy settings" (the default, but check it:
     any other choice ignores the Windows setting). Or, for Firefox alone, "Automatic proxy
     configuration URL" with the same URL. Both browsers pick up a change to the Windows setting on
     the next page load; no restart.

**Then** open `https://local.snowglobe.at/`, the network's page. Its apps link to themselves, for instance
`https://atmo.app.local.snowglobe.at` once atmo is routed (below).

**When you are done**, turn the setting off, or leave it: it sends only devnet names anywhere, and
those fail anyway while the devnet is down. What a browser does when it cannot fetch the PAC itself
was not measured.

`proxy.pac` leaves `plc.directory` alone, so the setting never moves the real directory for your
everyday browsing; apps on the devnet use `https://plc.local.snowglobe.at`. For an app that insists on
`plc.directory` in the browser, a profile used only for the devnet can take
`http://127.0.0.1:1080/proxy-with-plc.pac`, where it is this devnet's PLC.

Measured on 2026-10-19, on Windows: Chrome through the Windows "Use setup script" setting (the PAC
then named a SOCKS5 proxy), and Firefox both through its own "Automatic proxy configuration URL" and
through "Use system proxy settings" (an HTTP proxy), reached the page and a handle's own name. Firefox
uses the Windows setting only when its Network Settings say "Use system proxy settings": with any other
choice it fetches no PAC and the devnet's names do not resolve. In the dev
container, full Chromium and Firefox set only to the PAC URL went from the page to atmo and signed in
through the alpha's sign-in and consent pages, asking no host outside the devnet, with either kind
of proxy. Not measured: Edge, macOS, Linux desktops. Playwright's default headless shell ignores
`--proxy-pac-url`; real Chrome and Edge are the full build.

#### With launch flags (Chrome, Edge)

1. **Forward port 443**, in VS Code's Ports view: container 443 to host **443** exactly. The PDS's
   URLs carry no port, and VS Code quietly picks another local port when 443 is taken, so check the
   forwarded address. Forward your app's own port too if the browser opens it directly.
2. **Map the names to `127.0.0.1` for the browser.** Start a separate Chrome or Edge instance with
   its own profile directory, so the flag takes effect even when the browser is already open:

   ```
   rem cmd.exe; in PowerShell, write $env:TEMP for %TEMP%
   chrome.exe --user-data-dir=%TEMP%\devnet-https --host-resolver-rules="MAP local.snowglobe.at 127.0.0.1, MAP *.local.snowglobe.at 127.0.0.1, MAP plc.directory 127.0.0.1"
   ```

   The wildcard rule covers the PDS names and the handles; the bare `local.snowglobe.at`, the network's
   page, needs its own. Hosts-file entries work too, one name at a time; they need admin, and they
   point `plc.directory` at the devnet for every program on the computer until you remove the line.
3. **Trust the CA**, as in step 1 of the proxy's steps.

## Worked scenarios

[`sandbox/opensocial`](https://github.com/tompscanlan/atproto/tree/sandbox/opensocial-lexicons/sandbox/opensocial)
is a cookbook that runs on this stack: all of the overlays above. It starts from a clean checkout and
runs probes for:

- OAuth `space:` scopes that name a space type;
- members on other PDS builds joining a group;
- a group's members-only events kept in a space;
- private RSVPs, and who can read them.

Each probe prints its requests and a list of verdicts. The README records what we saw, so you can
compare a run against it.

## When the bug is inside the PDS: dev-env

devnet runs published images, so it's the right place to see how your app behaves against a real
PDS, PLC and Jetstream. To step through PDS code, run a branch with your own edits, or test several
PDSes talking to each other, use atproto's in-process network instead:
[`packages/dev-env`](https://github.com/bluesky-social/atproto/tree/main/packages/dev-env) in the
atproto monorepo. It builds PLC and PDSes from source in one Node process. On the
`permissioned-data*` branches, `bin-multi-pds` starts three PDSes with a lexicon authority already
wired in, and you can attach a debugger to it.

A worked example is
[`sandbox/opensocial`](https://github.com/tompscanlan/atproto/tree/sandbox/opensocial-lexicons/sandbox/opensocial).
It has a script that publishes a set of unpublished lexicons and a probe that signs in with OAuth
`space:` scopes naming them, and both run against either dev-env or this repo's spaces overlay.

## Configuration

All settings have sensible defaults. Override via `.env` or environment variables:

### Infrastructure (consumer provides)

| Variable | Default | Description |
|----------|---------|-------------|
| `SG_DB_USER` | `postgres` | PostgreSQL username |
| `SG_DB_PASSWORD` | `postgres` | PostgreSQL password |
| `SG_DB_HOST` | `postgres` | PostgreSQL hostname |
| `SG_DB_PORT` | `5432` | PostgreSQL port |
| `SG_DB_NAME` | `plc` | Database name for PLC |
| `SG_SMTP_URL` | `smtp://maildev:1025` | SMTP server for PDS email. Under `npm run up`, the test overlay sets the PDS's SMTP URL to `smtp://maildev:1025` directly, so this has no effect there |

### PDS settings

| Variable | Default | Description |
|----------|---------|-------------|
| `SG_DOMAIN` | `local.snowglobe.at` | The https devnet's domain, which every name there sits under ([The https devnet](#the-https-devnet)). The plain stack does not read it |
| `SG_PDS_HOSTNAME` | `devnet.test` | PDS service hostname (the https devnet names its PDSes itself) |
| `SG_PDS_IMAGE` | `ghcr.io/bluesky-social/pds:0.4` | PDS image (see [Choosing a PDS version](#choosing-a-pds-version)) |
| `SG_PDS_ADMIN_PASSWORD` | `devnet-admin-password` | PDS admin password |
| `SG_APPVIEW_URL` / `SG_APPVIEW_DID` | `https://appview.invalid` / `did:example:invalid` | Where the PDS forwards app.bsky.* reads and methods it doesn't implement. Unresolvable, so nothing reaches Bluesky |
| `SG_REPORT_SERVICE_URL` / `SG_REPORT_SERVICE_DID` | `https://moderator.invalid` / `did:example:invalid` | Where reports go |
| `SG_HANDLE_DOMAIN` | `.devnet.test` | Handle suffix for accounts (the https devnet uses `.` + `SG_DOMAIN`) |
| `SG_SEED_ACCOUNTS` | `true` | Create alice/bob on startup |
| `SG_PDS_REGULAR_IMAGE` / `SG_PDS_PROD_IMAGE` | `ghcr.io/bluesky-social/pds:0.4.5037` / a pinned production digest | The two extra PDS builds ([Several PDS builds side by side](#several-pds-builds-side-by-side)) |
| `SG_LEXICON_AUTHORITY_DID` | empty | The spaces PDS's lexicon authority ([Spaces PDS and unpublished lexicons](#spaces-pds-and-unpublished-lexicons)) |
| `SG_RELAY_INDIGO_COMMIT` | `b2619d8...` | The indigo commit the relay image builds from |
| `SG_RELAY_ADMIN_PASSWORD` | `devnet-relay-admin` | The relay's admin password |

### Host port mapping

| Variable | Default | Description |
|----------|---------|-------------|
| `SG_PDS_PORT` | `3000` | PDS |
| `SG_PLC_PORT` | `2582` | PLC |
| `SG_JETSTREAM_PORT` | `6008` | Jetstream WebSocket |
| `SG_JETSTREAM_METRICS_PORT` | `6009` | Jetstream metrics |
| `SG_TAP_PORT` | `2480` | Tap |
| `SG_SPACES_PDS_PORT` | `3010` | The spaces PDS. `SG_PDS_PORT` applies to the default PDS only, and `pds-regular` and `pds-prod` always use 3020 and 3030 |
| `SG_RELAY_PORT` | `2470` | Relay |
| `SG_POSTGRES_PORT` | `5433` | Postgres (`npm run up` only) |
| `SG_MAILDEV_WEB_PORT` / `SG_MAILDEV_SMTP_PORT` | `1081` / `1026` | MailDev (`npm run up` only) |

`create-account.sh` and the test suite reach the PDS at `SG_PDS_URL` (default
`http://localhost:3000`). `lexicon-authority.sh` defaults it to the spaces PDS on 3010. The tests
also read `SG_PLC_URL`, `SG_JETSTREAM_WS_URL`, `SG_JETSTREAM_METRICS_URL` and
`SG_TAP_URL`, each defaulting to localhost on the ports above.

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run up` | Start devnet + test infrastructure (standalone mode) |
| `npm run down` | Stop and remove all containers and volumes |
| `npm run logs` | Tail logs from all services |
| `npm test` | Run the full test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:health` | Run health checks only |

## Test suite

The test suite validates all major operations against a running devnet:

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
each command's refusals. For the https devnet end to end on a machine, `node scripts/smoke.mjs`
runs the whole sequence (`check`, `up`, `account` on two PDSes, `invite`, `lexicons`, `app` add and
remove, `run`, `down -v`) on a copy of the checkout, as compose project `snowglobe-smoke` on
`127.0.0.3`, and prints one line per step; it exits 0 only when every step passed. The checkout's
own `data/` is not touched. It takes a few minutes, more on a first run that pulls the images.

## License

MIT
