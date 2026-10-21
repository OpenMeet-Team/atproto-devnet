# Configuration

All settings have sensible defaults. Override via `.env` or environment variables:

## Infrastructure (consumer provides)

| Variable | Default | Description |
|----------|---------|-------------|
| `SG_DB_USER` | `postgres` | PostgreSQL username |
| `SG_DB_PASSWORD` | `postgres` | PostgreSQL password |
| `SG_DB_HOST` | `postgres` | PostgreSQL hostname |
| `SG_DB_PORT` | `5432` | PostgreSQL port |
| `SG_DB_NAME` | `plc` | Database name for PLC |
| `SG_SMTP_URL` | `smtp://maildev:1025` | SMTP server for PDS email. Under `npm run up`, the test overlay sets the PDS's SMTP URL to `smtp://maildev:1025` directly, so this has no effect there |

## PDS settings

| Variable | Default | Description |
|----------|---------|-------------|
| `SG_DOMAIN` | `local.snowglobe.at` | The https devnet's domain, which every name there sits under ([The https devnet](globe.md#the-https-devnet)). The plain stack does not read it |
| `SG_PDS_HOSTNAME` | `devnet.test` | PDS service hostname (the https devnet names its PDSes itself) |
| `SG_PDS_IMAGE` | `ghcr.io/bluesky-social/pds:0.4` | PDS image (see [Choosing a PDS version](quick-stack.md#choosing-a-pds-version)) |
| `SG_PDS_ADMIN_PASSWORD` | `devnet-admin-password` | PDS admin password |
| `SG_APPVIEW_URL` / `SG_APPVIEW_DID` | `https://appview.invalid` / `did:example:invalid` | Where the PDS forwards app.bsky.* reads and methods it doesn't implement. Unresolvable, so nothing reaches Bluesky |
| `SG_REPORT_SERVICE_URL` / `SG_REPORT_SERVICE_DID` | `https://moderator.invalid` / `did:example:invalid` | Where reports go |
| `SG_HANDLE_DOMAIN` | `.devnet.test` | Handle suffix for accounts (the https devnet uses `.` + `SG_DOMAIN`) |
| `SG_SEED_ACCOUNTS` | `true` | Create alice/bob on startup |
| `SG_PDS_REGULAR_IMAGE` / `SG_PDS_PROD_IMAGE` | `ghcr.io/bluesky-social/pds:0.4.5037` / a pinned production digest | The two extra PDS builds ([Several PDS builds side by side](quick-stack.md#several-pds-builds-side-by-side)) |
| `SG_LEXICON_AUTHORITY_DID` | empty | The spaces PDS's lexicon authority ([Spaces PDS and unpublished lexicons](quick-stack.md#spaces-pds-and-unpublished-lexicons)) |
| `SG_RELAY_INDIGO_COMMIT` | `b2619d8...` | The indigo commit the relay image builds from |
| `SG_RELAY_ADMIN_PASSWORD` | `devnet-relay-admin` | The relay's admin password |

## Host port mapping

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
