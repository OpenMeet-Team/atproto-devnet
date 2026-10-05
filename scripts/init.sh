#!/bin/sh
set -eu

# atproto-devnet init: create invite code, seed accounts, write credentials
# Runs as a one-shot container after PDS + PLC are healthy.

PDS_URL="http://pds:3000"
DATA_DIR="/devnet-data"

log() { echo "[init] $*"; }

# Install curl + jq (alpine base image)
apk add --no-cache curl jq >/dev/null 2>&1

# Wait for PDS to be truly ready (healthcheck may pass before XRPC is ready)
log "Waiting for PDS XRPC..."
for i in $(seq 1 30); do
  if curl -sf "${PDS_URL}/xrpc/_health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ── Create invite code ────────────────────────────────────────────
log "Creating invite code..."
INVITE_RESPONSE=$(curl -sf -X POST "${PDS_URL}/xrpc/com.atproto.server.createInviteCode" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n "admin:${PDS_ADMIN_PASSWORD}" | base64)" \
  -d '{"useCount": 100}')

INVITE_CODE=$(echo "$INVITE_RESPONSE" | jq -r '.code')
log "Invite code: ${INVITE_CODE}"

# ── Seed accounts ─────────────────────────────────────────────────
if [ "${SEED_ACCOUNTS}" = "true" ]; then
  # Skip if accounts were already seeded on THIS PDS (idempotent re-runs). data/ is a
  # host directory that outlives `down -v`, so after a fresh volume (or a different
  # PDS image) accounts.json can name accounts the running PDS has never seen.
  SEEDED_DID=$(jq -r '[.. | objects | select(has("did")) | .did][0] // empty' "${DATA_DIR}/accounts.json" 2>/dev/null || true)
  # getRepoStatus answers from the PDS's own store, with no DID resolution.
  if [ -n "${SEEDED_DID}" ] && curl -sf "${PDS_URL}/xrpc/com.atproto.sync.getRepoStatus?did=${SEEDED_DID}" >/dev/null 2>&1; then
    log "Accounts already seeded, skipping."
  else
  log "Seeding accounts..."

  # Initialize output files
  echo "{}" > "${DATA_DIR}/accounts.json"
  : > "${DATA_DIR}/accounts.env"
  echo "DEVNET_INVITE_CODE=${INVITE_CODE}" >> "${DATA_DIR}/accounts.env"

  create_account() {
    local handle="$1"
    local email="$2"
    local password="$3"
    local var_prefix="$4"

    log "Creating account: ${handle}"
    RESULT=$(curl -sf -X POST "${PDS_URL}/xrpc/com.atproto.server.createAccount" \
      -H "Content-Type: application/json" \
      -d "{
        \"handle\": \"${handle}\",
        \"email\": \"${email}\",
        \"password\": \"${password}\",
        \"inviteCode\": \"${INVITE_CODE}\"
      }")

    DID=$(echo "$RESULT" | jq -r '.did')
    ACCESS_JWT=$(echo "$RESULT" | jq -r '.accessJwt')

    if [ "$DID" = "null" ] || [ -z "$DID" ]; then
      log "WARNING: Failed to create ${handle}: $(echo "$RESULT" | jq -r '.message // "unknown error"')"
      return 1
    fi

    log "Created ${handle} → ${DID}"

    # Append to accounts.env
    echo "${var_prefix}_HANDLE=${handle}" >> "${DATA_DIR}/accounts.env"
    echo "${var_prefix}_DID=${DID}" >> "${DATA_DIR}/accounts.env"
    echo "${var_prefix}_PASSWORD=${password}" >> "${DATA_DIR}/accounts.env"
    echo "${var_prefix}_EMAIL=${email}" >> "${DATA_DIR}/accounts.env"

    # Append to accounts.json
    ACCOUNTS=$(cat "${DATA_DIR}/accounts.json")
    echo "$ACCOUNTS" | jq \
      --arg handle "$handle" \
      --arg did "$DID" \
      --arg password "$password" \
      --arg email "$email" \
      ". + {\"${var_prefix}\": {\"handle\": \$handle, \"did\": \$did, \"password\": \$password, \"email\": \$email}}" \
      > "${DATA_DIR}/accounts.json"

    return 0
  }

  create_account \
    "alice${HANDLE_DOMAIN}" \
    "alice@devnet.test" \
    "alice-devnet-pass" \
    "ALICE"

  create_account \
    "bob${HANDLE_DOMAIN}" \
    "bob@devnet.test" \
    "bob-devnet-pass" \
    "BOB"

  log "Accounts seeded. Credentials in ${DATA_DIR}/accounts.env"
  fi
else
  log "Skipping account seeding (SEED_ACCOUNTS=${SEED_ACCOUNTS})"
  echo "DEVNET_INVITE_CODE=${INVITE_CODE}" > "${DATA_DIR}/accounts.env"
fi

# Make output files world-readable/writable so host user can read them
chmod 666 "${DATA_DIR}/accounts.env" "${DATA_DIR}/accounts.json" 2>/dev/null || true

log "Init complete."
