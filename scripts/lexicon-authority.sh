#!/bin/sh
set -eu

# Create (or find) the lexicon authority account on the spaces PDS, and print the
# DID to start the PDS with. Phase 2 of the docker-compose.spaces.yml boot.
#
# Usage: ./scripts/lexicon-authority.sh
#
# The PDS reads PDS_LEXICON_AUTHORITY_DID only at startup, and the authority's
# DID only exists once the PDS is up, so the boot is two passes:
#   1. up with docker-compose.spaces.yml        (authority unset)
#   2. this script, then recreate the pds service with the printed DID
#
# Then publish lexicons into the account as com.atproto.lexicon.schema records,
# record key = the NSID. Every NSID the PDS resolves comes from this account,
# including any permission set an app's OAuth scope names with include:.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
DATA_DIR="${ROOT_DIR}/data"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  . "${ROOT_DIR}/.env"
  set +a
fi

PDS_URL="${DEVNET_PDS_URL:-http://localhost:${DEVNET_SPACES_PDS_PORT:-3010}}"
HANDLE="${DEVNET_LEX_AUTHORITY_HANDLE:-lex-authority${DEVNET_HANDLE_DOMAIN:-.devnet.test}}"
PASSWORD="${DEVNET_LEX_AUTHORITY_PASSWORD:-lex-authority-devnet-pass}"

DID=$(curl -s -X POST "${PDS_URL}/xrpc/com.atproto.server.createSession" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"${HANDLE}\", \"password\": \"${PASSWORD}\"}" | jq -r '.did // empty')

if [ -z "${DID}" ]; then
  INVITE_CODE=$(grep '^DEVNET_INVITE_CODE=' "${DATA_DIR}/accounts.env" 2>/dev/null | cut -d= -f2 || true)
  if [ -z "${INVITE_CODE}" ]; then
    echo "No invite code in ${DATA_DIR}/accounts.env; has init run?" >&2
    exit 1
  fi
  RESULT=$(curl -s -X POST "${PDS_URL}/xrpc/com.atproto.server.createAccount" \
    -H "Content-Type: application/json" \
    -d "{
      \"handle\": \"${HANDLE}\",
      \"email\": \"lex-authority@devnet.test\",
      \"password\": \"${PASSWORD}\",
      \"inviteCode\": \"${INVITE_CODE}\"
    }")
  DID=$(echo "${RESULT}" | jq -r '.did // empty')
  if [ -z "${DID}" ]; then
    echo "createAccount failed: $(echo "${RESULT}" | jq -r '.message // .error // "unknown error"')" >&2
    exit 1
  fi
  echo "Created ${HANDLE} → ${DID}" >&2
else
  echo "Found ${HANDLE} → ${DID}" >&2
fi

echo "DEVNET_LEXICON_AUTHORITY_DID=${DID}"
echo >&2
echo "Recreate the PDS with it, using the same -f files and project as the first pass:" >&2
echo "  DEVNET_LEXICON_AUTHORITY_DID=${DID} docker compose <files> up -d --wait pds" >&2
