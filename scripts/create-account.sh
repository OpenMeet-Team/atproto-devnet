#!/bin/sh
set -eu

# Create a new account on the devnet PDS.
# Usage: ./scripts/create-account.sh <handle> [email] [password]
#
# Example:
#   ./scripts/create-account.sh carol.devnet.test carol@devnet.test carol-pass
#
# Outputs the DID and appends credentials to data/accounts.env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
DATA_DIR="${ROOT_DIR}/data"

# Source .env for port overrides
if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  . "${ROOT_DIR}/.env"
  set +a
fi

PDS_URL="${DEVNET_PDS_URL:-http://localhost:${DEVNET_PDS_PORT:-3000}}"
PDS_ADMIN_PASSWORD="${DEVNET_PDS_ADMIN_PASSWORD:-devnet-admin-password}"

HANDLE="${1:?Usage: create-account.sh <handle> [email] [password]}"
EMAIL="${2:-${HANDLE}@devnet.test}"
PASSWORD="${3:-$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16)}"

# Get or create invite code
if [ -f "${DATA_DIR}/accounts.env" ]; then
  INVITE_CODE=$(grep '^DEVNET_INVITE_CODE=' "${DATA_DIR}/accounts.env" | cut -d= -f2)
fi

if [ -z "${INVITE_CODE:-}" ]; then
  echo "Creating invite code..."
  INVITE_CODE=$(curl -sf -X POST "${PDS_URL}/xrpc/com.atproto.server.createInviteCode" \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic $(echo -n "admin:${PDS_ADMIN_PASSWORD}" | base64)" \
    -d '{"useCount": 100}' | jq -r '.code')
fi

echo "Creating account: ${HANDLE}"
RESULT=$(curl -sf -X POST "${PDS_URL}/xrpc/com.atproto.server.createAccount" \
  -H "Content-Type: application/json" \
  -d "{
    \"handle\": \"${HANDLE}\",
    \"email\": \"${EMAIL}\",
    \"password\": \"${PASSWORD}\",
    \"inviteCode\": \"${INVITE_CODE}\"
  }")

DID=$(echo "$RESULT" | jq -r '.did')

if [ "$DID" = "null" ] || [ -z "$DID" ]; then
  echo "ERROR: $(echo "$RESULT" | jq -r '.message // "unknown error"')" >&2
  exit 1
fi

# Derive a variable prefix from the handle (e.g., carol.devnet.test → CAROL)
VAR_PREFIX=$(echo "$HANDLE" | sed 's/\..*//' | tr '[:lower:]' '[:upper:]')

# Append to accounts.env
mkdir -p "${DATA_DIR}"
{
  echo "${VAR_PREFIX}_HANDLE=${HANDLE}"
  echo "${VAR_PREFIX}_DID=${DID}"
  echo "${VAR_PREFIX}_PASSWORD=${PASSWORD}"
  echo "${VAR_PREFIX}_EMAIL=${EMAIL}"
} >> "${DATA_DIR}/accounts.env"

echo "Created: ${HANDLE} → ${DID}"
echo "Password: ${PASSWORD}"
echo "Credentials appended to ${DATA_DIR}/accounts.env"
