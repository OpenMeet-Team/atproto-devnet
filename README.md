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
