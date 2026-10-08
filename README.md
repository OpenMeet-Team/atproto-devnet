# atproto-devnet

A standalone, self-contained [AT Protocol](https://atproto.com) development network for local development and CI. Provides a local PDS, PLC, Jetstream, and TAP — enough to create and manage PDS accounts, publish and read records, and test Jetstream consumers, all without touching production Bluesky infrastructure. This is not the full Bluesky stack (no AppView, relay, or feed generators), but it covers the core services most AT Protocol applications need for local development.

## Services

| Service | Image | Default Port | Purpose |
|---------|-------|-------------|---------|
| **PDS** | `ghcr.io/bluesky-social/pds:0.4` | 3000 | Personal Data Server — stores repos, handles auth |
| **PLC** | `itaru2622/bluesky-did-method-plc` | 2582 | DID registry — local resolution, no plc.directory dependency |
| **Jetstream** | `ghcr.io/bluesky-social/jetstream` | 6008 | JSON event stream from PDS firehose |
| **TAP** | `ghcr.io/bluesky-social/indigo/tap` | 2480 | Repo sync + backfill |
| **init** | `alpine:3.20` | — | One-shot: creates invite codes and seeds test accounts |

## Quick start (standalone)

Run the devnet with its own Postgres and MailDev for self-contained testing:

```bash
git clone https://github.com/OpenMeet-Team/atproto-devnet.git
cd atproto-devnet
cp .env.example .env
npm install

# Start all services (devnet + test infrastructure)
npm run up

# Run the test suite
npm test

# Stop everything
npm run down
```

The test suite validates health checks, account seeding, record CRUD, Jetstream events, firehose output, and network isolation.

## Upgrading from earlier versions

Changes to the default stack that existing setups will notice:

- **The PDS no longer forwards to Bluesky's AppView.** `app.bsky.*` reads and any method the PDS
  doesn't implement now go to `https://appview.invalid` and fail with `502 UpstreamFailure`.
  Bluesky's AppView never indexed devnet accounts, so for those accounts nothing useful is lost. To
  get the old behavior back, set `DEVNET_APPVIEW_URL=https://api.bsky.app`,
  `DEVNET_APPVIEW_DID=did:web:api.bsky.app`, `DEVNET_REPORT_SERVICE_URL=https://mod.bsky.app` and
  `DEVNET_REPORT_SERVICE_DID=did:plc:ar7c4by46qjdydhdevvrndac`. The isolation test will then fail
  by design.
- **DID resolution works again on current `pds:0.4` pulls.** Since `@atproto/pds` 0.5.34, the PDS
  refuses to resolve DIDs through an `http://` PLC unless SSRF protection is off, and the floating
  `pds:0.4` tag now pulls 0.5.36. Without the fix, `describeRepo`, OAuth and anything else that
  resolves a new DID fails with `Forbidden protocol "http:"`. The PDS now sets
  `PDS_DISABLE_SSRF_PROTECTION=true`, so it can also fetch private addresses, such as an OAuth client's
  metadata on your machine.
- **init reseeds when `data/` is stale.** `data/` outlives `npm run down`. init used to skip seeding
  whenever `data/accounts.json` existed, leaving credentials for accounts that were gone. It now
  checks that the recorded accounts exist on the running PDS and reseeds if they don't, so
  `data/accounts.env` gets new DIDs and a new invite code.
- **The PDS runs as root.** Release images already did. This lets `DEVNET_PDS_IMAGE` take monorepo
  images, which default to `node`.

## Integrating into your project

atproto-devnet is designed to be **composed into** your project's Docker environment using [Docker Compose file stacking](https://docs.docker.com/compose/how-it-works/#merge). Clone it as a sibling directory and layer it with a thin overlay file in your project.

### Prerequisites

Your project needs to provide two things that atproto-devnet expects from the network:

1. **PostgreSQL** — PLC stores DIDs here (database name configurable via `DEVNET_DB_NAME`)
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
    ├── docker-compose.yml          # PDS, PLC, Jetstream, TAP, init
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

The `--project-directory .` flag ensures volume paths resolve relative to your project, not the devnet repo.

## Real-world examples

### OpenMeet (reuses existing Postgres + MailDev)

OpenMeet's API already runs Postgres and MailDev. The overlay connects devnet services to OpenMeet's network and reuses its infrastructure.

**`docker-compose-devnet.yml`** (overlay):
```yaml
services:
  # Connect PLC to OpenMeet's existing postgres
  plc:
    environment:
      DEVNET_DB_HOST: postgres
      DEVNET_DB_USER: ${DATABASE_USERNAME}
      DEVNET_DB_PASSWORD: ${DATABASE_PASSWORD}
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
      - PDS_DID_PLC_URL=http://plc:2582

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

See the full implementation: [OpenMeet-Team/openmeet-api `feature/adopt-atproto-devnet`](https://github.com/OpenMeet-Team/openmeet-api/tree/feature/adopt-atproto-devnet)

### Open Social (provides its own Postgres + MailDev)

Open Social doesn't have existing Postgres/MailDev services, so its overlay provides them — similar to `docker-compose.test.yml` but tailored to Open Social's needs.

**`docker-compose.devnet.yml`** (overlay):
```yaml
services:
  # Provide postgres for both PLC and Open Social
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DEVNET_DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DEVNET_DB_PASSWORD:-postgres}
      POSTGRES_DB: ${DEVNET_DB_NAME:-plc}
    volumes:
      - ${OPENSOCIAL_DIR}/scripts/init-opensocial-db.sh:/docker-entrypoint-initdb.d/10-opensocial.sh:ro
    ports:
      - "${DEVNET_POSTGRES_PORT:-5433}:5432"
    networks:
      - atproto-devnet
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DEVNET_DB_USER:-postgres}"]
      interval: 3s
      timeout: 3s
      retries: 10

  # Provide maildev for PDS email verification
  maildev:
    image: maildev/maildev:latest
    ports:
      - "${DEVNET_MAILDEV_WEB_PORT:-1081}:1080"
      - "${DEVNET_MAILDEV_SMTP_PORT:-1026}:1025"
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

## Seeded test accounts

When `DEVNET_SEED_ACCOUNTS=true` (the default), the init container creates two test accounts and writes their credentials to `data/accounts.json` and `data/accounts.env`:

| Account | Handle | Password |
|---------|--------|----------|
| Alice | `alice.devnet.test` | `alice-devnet-pass` |
| Bob | `bob.devnet.test` | `bob-devnet-pass` |

Create additional accounts at any time:

```bash
./scripts/create-account.sh carol.devnet.test
```

## Choosing a PDS version

`DEVNET_PDS_IMAGE` picks the PDS image, so you can run your app or the test suite against another
release, an unreleased upstream commit, or the spaces alpha:

```bash
npm run down      # fresh volumes: a newer PDS migrates its database, and an older one can't read it
DEVNET_PDS_IMAGE=ghcr.io/bluesky-social/pds:0.4.5037 npm run up && npm test
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
./scripts/lexicon-authority.sh            # prints DEVNET_LEXICON_AUTHORITY_DID=did:plc:...
DEVNET_LEXICON_AUTHORITY_DID=did:plc:... docker compose $F up -d --wait   # whole stack, not just pds
# then putRecord your lexicons into the authority account
```

How this differs from the default stack:

- **PDS on 3010, at `http://localhost:3010`.** The authority account lives on this PDS, and its DID
  document's endpoint has to reach the PDS both from inside its container (to resolve lexicons) and
  from the host. `PDS_HOSTNAME=localhost` makes the endpoint `http://localhost:<PDS_PORT>`, so the
  container and host ports must match. `PDS_DEV_MODE` turns off the SSRF protection that would
  refuse a localhost fetch. Override the port with `DEVNET_SPACES_PDS_PORT`.
- **Digest-pinned image.** Set `DEVNET_PDS_IMAGE` to try another spaces build.

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
| `pds` | `http://localhost:3010` | `DEVNET_PDS_IMAGE` | spaces alpha `79d6307e` | `.devnet.test` |
| `pds-regular` | `http://localhost:3020` | `DEVNET_PDS_REGULAR_IMAGE` | `pds:0.4.5037` | `.regular.devnet.test` |
| `pds-prod` | `http://localhost:3030` | `DEVNET_PDS_PROD_IMAGE` | `pds:0.4.5009` (by digest) | `.prod.devnet.test` |

Set `DEVNET_PDS_PROD_IMAGE` to whatever your production PDS runs.

Each PDS writes `http://localhost:<port>` into its accounts' DID documents. For one PDS to reach
another's accounts, that URL has to work inside every PDS container as well as on the host, so the
two extra PDSes share the alpha's network namespace (`network_mode: service:pds`). Other containers
reach them as `pds:3020` and `pds:3030`. The extra PDSes don't require invites, and each has its own
service DID, since all three would otherwise be `did:web:localhost`. On their own, Jetstream and TAP
follow only the alpha; add the local relay below to get one stream from all three.

A PDS forwards any XRPC method it doesn't implement (`com.atproto.space.*` on a non-spaces build,
for one) to its AppView with a service-auth token. On a stock build that shows up as `502
UpstreamFailure`, because every devnet PDS points its AppView at `https://appview.invalid` (see
`DEVNET_APPVIEW_URL`).

## A local relay

`docker-compose.relay.yml`, stacked after the multi-PDS overlay, adds a relay that crawls all three
PDSes. Jetstream and TAP read from the relay, which is the shape production has:

```
PDSes --> relay (:2470) --> Jetstream (:6008)
                       \--> TAP (:2480)
```

```bash
F="$F -f docker-compose.relay.yml"
docker compose $F up -d --wait     # builds the relay image the first time
```

`relay-init` registers each PDS through the relay's admin API, because a relay won't accept a
localhost host from a PDS's own `requestCrawl`. The relay and TAP join the PDSes' network namespace,
so the `http://localhost:<port>` URLs in DID documents work for them as well.

**The relay is built locally, not pulled.** Upstream's relay (`ghcr.io/bluesky-social/indigo:relay-<commit>`)
checks every host through an SSRF-safe transport that refuses loopback and private addresses, with
no setting to turn it off. Its admin `requestCrawl` accepts `localhost:<port>`, and the host check
then fails with `unsafe network address`, so the published image can never crawl a devnet PDS.
`relay/Dockerfile` builds the same upstream commit with `relay/allow-private-hosts.patch`, which
adds one opt-in setting, `RELAY_ALLOW_PRIVATE_HOSTS`, and copies the binary into the published
image. The setting covers both places the relay refuses those addresses: the host check, and the
firehose dialer for `wss://` hosts, which [the https devnet](#the-https-devnet) needs because its
PDS names resolve to nginx's private address. Pick another commit with `DEVNET_RELAY_INDIGO_COMMIT`; it needs a published `relay-<commit>`
image, and the patch has to apply.

## The https devnet

The stacks above serve every PDS at `http://localhost:<port>`, so an app has to be told it is on a
devnet before it will sign in there: allow plain http, and ask the devnet PLC instead of
`plc.directory`. `docker-compose.https.yml` goes the other way. Stacked last on the five files above,
it makes the whole spaces stack look like the real network, so an app built for the real network
runs against it with no devnet code:

| Name | Served by |
| --- | --- |
| `alpha.devnet.test`, `*.devnet.test` | `pds`, the spaces alpha (`79d6307e`), and its handles; invites required |
| `regular.devnet.test`, `*.regular.devnet.test` | `pds-regular`, a current release, and its handles |
| `prod.devnet.test`, `*.prod.devnet.test` | `pds-prod`, the build you run in prod, and its handles |
| `plc.directory` | this stack's own PLC |
| `<name>.devnet.internal` | an app on this machine, at the port `scripts/https-app.sh` recorded for `<name>` |

nginx answers all of them on `127.0.0.1:443` with one certificate from a local CA. Each PDS's
public URL, OAuth issuer and DID document endpoint is `https://<its name>`, and the relay crawls
the three PDSes as `wss://` hosts. On the machine, the names resolve to `127.0.0.1` only for
commands run under `scripts/https-run`, so every other program still reaches the real
`plc.directory`.

The devnet knows no app. It has no app's accounts, invite codes, lexicons or ports. It gives an app
tools to make its own (below), and using them is optional.

### Up and down

Every run names its compose project with `DEVNET_PROJECT`; there is no default. The scripts refuse
the shared project `devnet-spaces` unless `DEVNET_RESET_OK=1`, and exit before calling docker.

```bash
export DEVNET_PROJECT=devnet-mine
./scripts/https-up.sh     # certificates, two-pass authority boot, data/devnet.env
./scripts/https-down.sh   # stop it; -v also drops its volumes (every account and DID)
```

Both pass the same six files, the https overlay last:

```bash
F="-f docker-compose.yml -f docker-compose.test.yml -f docker-compose.spaces.yml"
F="$F -f docker-compose.multi-pds.yml -f docker-compose.relay.yml -f docker-compose.https.yml"
docker compose -p "$DEVNET_PROJECT" $F ps
```

`https-up.sh` is safe to rerun; a rerun is one `up`. It makes the leaf certificate if there is
none, brings the stack up, makes the lexicon authority (`lex-authority.devnet.test` on the alpha),
brings the stack up again with `DEVNET_LEXICON_AUTHORITY_DID` so every PDS starts with it, and writes
`data/devnet.env`. The base init still seeds `alice` and `bob` and a 100-use `DEVNET_INVITE_CODE`
into `data/accounts.env`, as it does for the http stacks. Nothing else is seeded.

Published ports, all on `127.0.0.1` only: 443 (nginx), the PLC (`DEVNET_PLC_PORT`), Jetstream
(`DEVNET_JETSTREAM_PORT`, `DEVNET_JETSTREAM_METRICS_PORT`) and maildev (`DEVNET_MAILDEV_WEB_PORT`,
`DEVNET_MAILDEV_SMTP_PORT`). Set those to run a second https devnet beside another; pass the same
values on every run. The PDS, relay, TAP and Postgres ports are not published: reach a PDS by its
https name. Port 443 is one per machine, so only one https devnet can serve at a time.

`https-down.sh` passes its arguments to `docker compose down` and never deletes `data/`. The PLC's
database is a named volume (`plc-db`), so a `down` without `-v` keeps every DID along with the
PDSes. After `-v`, the next `https-up.sh` starts over: init reseeds `alice` and `bob`, and the
authority is made again with a new DID.

### What it writes

`data/` is git-ignored:

- `data/devnet.env`: the devnet's own facts, nothing secret. `ALPHA_PDS_URL`, `REGULAR_PDS_URL`,
  `PROD_PDS_URL`, `PLC_URL` (`https://plc.directory`), `JETSTREAM_URL` (`ws://127.0.0.1:<port>`),
  `MAILDEV_URL`, `LEX_AUTHORITY_DID`, `LEX_AUTHORITY_HANDLE`, `DEVNET_PROJECT` and `DEVNET_CA_FILE`.
  An app can source it: `set -a; . <devnet>/data/devnet.env; set +a`.
- `data/accounts.env` (mode 600): logins. `DEVNET_INVITE_CODE`, `ALICE_*` and `BOB_*` from init,
  `LEX_AUTHORITY_*`, and whatever the tools below add.
- `data/https/`: `ca.crt` and `ca.key` (the CA), `leaf.crt` and `leaf.key` (what nginx serves),
  `names` (the handles `https-run` maps), `apps` and `nginx/` (the app routes), and `hosts` (the
  hosts file `https-run` last generated).

### Running a command against it: `https-run`

```bash
scripts/https-run getent hosts plc.directory     # 127.0.0.1 inside; the real address outside
(cd ../bookclub && ../atproto-devnet/scripts/https-run npm run dev)
```

`https-run <cmd>` runs the command with two changes, for its process tree only:

- the three PDS names, `plc.directory`, every handle in `data/https/names` and every app in
  `data/https/apps` (as `<name>.devnet.internal`) resolve to `127.0.0.1`.
  [bubblewrap](https://github.com/containers/bubblewrap) gives the command its own mount namespace,
  with a generated hosts file bound over `/etc/hosts`. Same filesystem, network and user otherwise.
  `HTTPS_RUN_EXTRA_NAMES` adds names.
- Node trusts the devnet CA on top of its own roots (`NODE_EXTRA_CA_CERTS=data/https/ca.crt`).
  Miniflare's source passes the same file to workerd, so a Worker's `fetch` should trust it too.

The names are read when the command starts. Handles are listed one by one (there is no wildcard
DNS), so restart a command under `https-run` to pick up a handle or app made after it started.
Node's certificate checks stay on: `https-run` only adds a CA for them to trust.

### Tools for an app

Each example uses a made-up app, `bookclub`. None of them prints a secret; a login or code goes only
to the file named.

**An account**, on any of the three PDSes: `scripts/https-account.sh <name> <PREFIX> [alpha|regular|prod]`.

```bash
scripts/https-account.sh bookclubowner BOOKCLUB_OWNER            # bookclubowner.devnet.test on the alpha
scripts/https-account.sh reader BOOKCLUB_READER regular          # reader.regular.devnet.test
```

It prints the DID alone, and a rerun finds the account instead of making another. The login goes to
`ACCOUNTS_FILE` (default `data/accounts.env`, mode 600) as `<PREFIX>_HANDLE`, `_DID`, `_PASSWORD`
and `_PDS`, and the handle goes to `data/https/names`. On the alpha it sends `DEVNET_INVITE_CODE`;
the other two require no invite and are sent none. The labels `alpha`, `regular` and `prod` are
refused on the alpha, where the handle would be another PDS's name.

**An invite code** on the alpha, for an app that creates accounts itself:
`scripts/https-invite.sh <VAR> [file]`.

```bash
scripts/https-invite.sh BOOKCLUB_INVITE_CODE ../bookclub/.env.devnet
```

It mints the code through the PDS's admin API (`INVITE_USES`, default 100) and writes
`<VAR>=<code>` to the file (default `data/accounts.env`, mode 600), replacing an earlier line.

**Lexicons.** With `PDS_LEXICON_AUTHORITY_DID` set, every devnet PDS resolves **every** NSID from
the authority account, never from DNS, so an app's record types, permission sets and space types
have to be published there as `com.atproto.lexicon.schema` records, keyed by NSID. An app publishes
its own:

```bash
scripts/https-lexicons.sh ../bookclub/lexicons    # prints each NSID: com.example.bookclub.review, ...
```

It publishes every lexicon JSON under the folder, at any depth, and leaves a record alone when it
already holds the same document. Or publish with the app's own tooling: sign in with the
`LEX_AUTHORITY_*` login in `data/accounts.env` and `putRecord` each document into
`com.atproto.lexicon.schema` with the NSID as the record key. The PDS caches what it resolves for
about five minutes.

**An app route**, so the app has an https origin that both the PDSes and `https-run`'s processes
reach: `scripts/https-app.sh <name> <port>`.

```bash
scripts/https-app.sh bookclub 5600     # https://bookclub.devnet.internal -> port 5600 on this machine
```

The app must listen where Docker's host gateway lands (`host.docker.internal` inside the
containers; the `docker0` address here), or on `0.0.0.0`. The route is kept in `data/https/apps` (a
rerun with the same name changes the port), and nginx in `DEVNET_PROJECT`'s stack is reloaded. A
`.devnet.internal` name with no route gets a 404 from nginx and reaches nothing. A confidential
OAuth client can use `https://bookclub.devnet.internal/...` as its client_id: the PDS fetches its
metadata and keys from there over TLS. A client_id under `.test` is refused by the PDS
(`invalid_client_id: The client_id's TLD must not be a local hostname`), which is why apps live under
`.devnet.internal`.

`scripts/https-probe.mjs` checks the whole path for any app name. It resolves an account through
`https://plc.directory` with stock atcute at its defaults, serves a confidential client at
`https://<PROBE_APP>.devnet.internal/`, pushes a PAR with that client_id, and pushes a raw PAR with a
`.test` client_id, which the PDS refuses. `ATCUTE_DIR` is required: a directory node resolves
`@atcute/oauth-node-client` and `@atcute/identity-resolver` from.

```bash
scripts/https-app.sh probe 5480
ATCUTE_DIR=<dir> PROBE_DID=<did> scripts/https-run node scripts/https-probe.mjs
```

```
RESOLVED did:plc:... on https://alpha.devnet.test through plc.directory, ... off
PAR ACCEPTED for confidential client https://probe.devnet.internal/probe-<run>/oauth-client-metadata.json
REFUSED .test client_id: HTTP 400 invalid_client_id: The client_id's TLD must not be a local hostname
```

### How it differs from the http stacks

- **Each PDS at its https name.** `PDS_HOSTNAME` is `alpha.devnet.test`, `regular.devnet.test` or
  `prod.devnet.test`, and the alpha's handle domain is set to `.devnet.test` explicitly (its default
  would be `.alpha.devnet.test`). The alpha runs without `PDS_DEV_MODE`, as it would on the real
  network; the two releases keep it. All three keep `PDS_DISABLE_SSRF_PROTECTION`, because everything
  they fetch here sits on an RFC 1918 address.
- **The PDSes reach each other over TLS.** Inside the compose network, nginx also answers to the
  three PDS names, and each PDS trusts the CA through `NODE_EXTRA_CA_CERTS`. Docker's DNS has no
  wildcard names, so each PDS preloads `https/app-names.cjs`, which looks up any `.devnet.internal`
  name as nginx. Only the address changes: the request keeps the app's name, and TLS still checks the
  certificate for it.
- **nginx routes by name.** Each PDS's block takes its name and its handle wildcard, and passes Host
  through, so the PDS answers `/.well-known/atproto-did` for a handle. Of two matching wildcards nginx
  takes the longer, so `*.regular.devnet.test` wins over `*.devnet.test`. A name nginx does not list
  gets no certificate at all.
- **The relay dials wss.** `relay-init` registers the three bare names, which the relay treats as
  https hosts. Their addresses are nginx's, a private one, so the relay is built with
  `relay/allow-private-hosts.patch`, whose `RELAY_ALLOW_PRIVATE_HOSTS` covers the firehose dialer as
  well as the host check (see [A local relay](#a-local-relay)). The CA is mounted into
  `/etc/ssl/certs`, which Go reads on top of its bundle. `RELAY_ALLOW_INSECURE_HOSTS` is dropped. The
  image has its own tag, `atproto-devnet-relay:https-<commit>`. The relay's `listHosts` shows a host
  only once it has sent an event.
- **TAP resync is not supported.** TAP follows the relay's stream, but it fetches a repo to resync
  through an SSRF-safe transport that refuses nginx's address, so a resync fails here.
- **Jetstream is unchanged**, at `ws://127.0.0.1:<DEVNET_JETSTREAM_PORT>`, reading the relay over the
  compose network.

### The CA

`scripts/https-ca.sh` (which `https-up.sh` runs when there is no leaf) makes the CA once. Rerunning
it keeps the CA and only reissues the leaf, so a browser or OS that trusts `ca.crt` keeps trusting
the devnet. The leaf names the three PDSes, `*.devnet.test`, `*.regular.devnet.test`,
`*.prod.devnet.test`, `plc.directory` and `*.devnet.internal`; a TLS wildcard covers one label, so
each handle domain needs its own. Add names with `HTTPS_EXTRA_NAMES="a.devnet.test b.devnet.test"`,
then restart nginx. To start over, delete `data/https/ca.*` and trust the new `ca.crt` wherever the
old one was trusted.

The CA can only vouch for servers under `devnet.test`, `devnet.internal` and `plc.directory` (name
constraints, server auth only, no IP addresses), so trusting it puts no other site at risk, even if
`data/https/ca.key` leaks. Keep that file on the dev machine, and remove the CA from a browser or OS
when you're done with it.

### From a browser on your own computer

nginx runs in the dev container. To use the devnet from a browser on the host:

1. **Forward port 443**, in VS Code's Ports view: container 443 to host **443** exactly. The PDS's
   URLs carry no port, and VS Code quietly picks another local port when 443 is taken, so check the
   forwarded address. Forward your app's own port too if the browser opens it directly.
2. **Map the names to `127.0.0.1` for the browser.** Start a separate Chrome or Edge instance with
   its own profile directory, so the flag takes effect even when the browser is already open:

   ```
   rem cmd.exe; in PowerShell, write $env:TEMP for %TEMP%
   chrome.exe --user-data-dir=%TEMP%\devnet-https --host-resolver-rules="MAP *.devnet.test 127.0.0.1, MAP plc.directory 127.0.0.1, MAP *.devnet.internal 127.0.0.1"
   ```

   A wildcard rule also covers the three PDS names. Hosts-file entries work too, one name at a time;
   they need admin, and they point `plc.directory` at the devnet for every program on the computer
   until you remove the line.
3. **Trust the CA, once.** If your host already trusts this `ca.crt`, there is nothing to do:
   `https-ca.sh` keeps the CA. Otherwise copy `data/https/ca.crt` to the host and add it to your
   user's root store: `certutil -user -addstore Root ca.crt` (no admin; Windows asks you to confirm).
   Remove it later with `certutil -user -delstore Root "atproto-devnet local CA"`. Clicking through a
   certificate warning instead covers only the page you clicked through, not the requests an app's
   code in the browser makes to `plc.directory` or a PDS.

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
| `DEVNET_DB_USER` | `postgres` | PostgreSQL username |
| `DEVNET_DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DEVNET_DB_HOST` | `postgres` | PostgreSQL hostname |
| `DEVNET_DB_PORT` | `5432` | PostgreSQL port |
| `DEVNET_DB_NAME` | `plc` | Database name for PLC |
| `DEVNET_SMTP_URL` | `smtp://maildev:1025` | SMTP server for PDS email |

### PDS settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVNET_PDS_HOSTNAME` | `devnet.test` | PDS service hostname |
| `DEVNET_PDS_IMAGE` | `ghcr.io/bluesky-social/pds:0.4` | PDS image (see [Choosing a PDS version](#choosing-a-pds-version)) |
| `DEVNET_PDS_ADMIN_PASSWORD` | `devnet-admin-password` | PDS admin password |
| `DEVNET_APPVIEW_URL` / `DEVNET_APPVIEW_DID` | `https://appview.invalid` / `did:example:invalid` | Where the PDS forwards app.bsky.* reads and methods it doesn't implement. Unresolvable, so nothing reaches Bluesky |
| `DEVNET_REPORT_SERVICE_URL` / `DEVNET_REPORT_SERVICE_DID` | `https://moderator.invalid` / `did:example:invalid` | Where reports go |
| `DEVNET_HANDLE_DOMAIN` | `.devnet.test` | Handle suffix for accounts |
| `DEVNET_SEED_ACCOUNTS` | `true` | Create alice/bob on startup |

### Host port mapping

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVNET_PDS_PORT` | `3000` | PDS |
| `DEVNET_PLC_PORT` | `2582` | PLC |
| `DEVNET_JETSTREAM_PORT` | `6008` | Jetstream WebSocket |
| `DEVNET_JETSTREAM_METRICS_PORT` | `6009` | Jetstream metrics |
| `DEVNET_TAP_PORT` | `2480` | TAP |

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
| `isolation.test.ts` | Network is fully isolated (no external PLC/crawlers) |
| `tap.test.ts` | TAP tracks DIDs and syncs repos |

## License

MIT
