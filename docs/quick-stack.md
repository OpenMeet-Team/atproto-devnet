# The quick stack

> **Deprecated.** New work goes into the globe ([the https devnet](globe.md)). The quick stack
> still runs from `main` for now. A project that depends on it should pin a release tag, as
> OpenMeet's CI pins `v0.1.0`.

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
- `relay` on 2470 and a one-shot `relay-init` ([A local relay](#a-local-relay)).

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
comes with [the https devnet](globe.md), at `https://local.snowglobe.at/`
([The network's page](globe.md#the-networks-page)).

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
[`bin/snowglobe.mjs account`](your-app.md#tools-for-an-app) instead, which needs only Node and prints no
password.

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

How the relay image is built: [The relay, built locally](how-it-works.md#the-relay-built-locally).

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

Override these in `.env` or in the environment.

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
| `SG_PDS_HOSTNAME` | `devnet.test` | PDS service hostname (a globe names its PDSes itself) |
| `SG_PDS_IMAGE` | `ghcr.io/bluesky-social/pds:0.4` | PDS image (see [Choosing a PDS version](#choosing-a-pds-version)) |
| `SG_PDS_ADMIN_PASSWORD` | `devnet-admin-password` | PDS admin password |
| `SG_APPVIEW_URL` / `SG_APPVIEW_DID` | `https://appview.invalid` / `did:example:invalid` | Where the PDS forwards app.bsky.* reads and methods it doesn't implement. Unresolvable, so nothing reaches Bluesky |
| `SG_REPORT_SERVICE_URL` / `SG_REPORT_SERVICE_DID` | `https://moderator.invalid` / `did:example:invalid` | Where reports go |
| `SG_HANDLE_DOMAIN` | `.devnet.test` | Handle suffix for accounts (a globe uses `.` + its domain) |
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
