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
DEVNET_LEXICON_AUTHORITY_DID=did:plc:... docker compose $F up -d --wait pds
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
service DID, since all three would otherwise be `did:web:localhost`. Jetstream and TAP still follow
only the alpha.

The extra PDSes point their AppView at `https://appview.invalid`, because a PDS forwards any XRPC
method it doesn't implement (`com.atproto.space.*` on a non-spaces build, for one) to its AppView
with a service-auth token. **The default stack points at `https://api.bsky.app`**, so a test that
calls an unimplemented method there sends that request to Bluesky's production AppView.

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
