#!/bin/sh
set -eu

# Mint an invite code on the https devnet's alpha (the one PDS that requires invites)
# and keep it as <VAR>=<code> in an env file. The code is never printed.
#
# Usage: ./scripts/https-invite.sh <VAR> [file]
#   <VAR>   the variable to write, e.g. MYAPP_INVITE_CODE
#   [file]  default data/accounts.env; kept mode 600. An earlier <VAR> line is replaced.
#
# Env: INVITE_USES (default 100), and DEVNET_PDS_ADMIN_PASSWORD if the stack was started
# with one (the compose default otherwise). The code is made through the PDS's admin
# API (com.atproto.server.createInviteCode) over https.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

VAR="${1:-}"
FILE="${2:-${DEVNET_ACCOUNTS}}"
if ! echo "${VAR}" | grep -qxE '[A-Z_][A-Z0-9_]*'; then
  echo "Usage: https-invite.sh <VAR> [file]   (VAR: A-Z, 0-9, _)" >&2
  exit 2
fi
USES="${INVITE_USES:-100}"
echo "${USES}" | grep -qxE '[1-9][0-9]*' || {
  echo "https-invite: INVITE_USES must be a positive number" >&2
  exit 2
}

# The admin login goes in a header file only this user can read, not on a command line.
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
(
  umask 077
  printf 'Authorization: Basic %s\n' \
    "$(printf 'admin:%s' "${DEVNET_PDS_ADMIN_PASSWORD:-devnet-admin-password}" | base64 | tr -d '\n')" > "${TMP}/auth"
)

RESULT=$(jq -n --argjson n "${USES}" '{useCount: $n}' \
  | devnet_curl "https://$(pds_name alpha)/xrpc/com.atproto.server.createInviteCode" \
      -X POST -H "Content-Type: application/json" -H @"${TMP}/auth" --data-binary @-)
CODE=$(echo "${RESULT}" | jq -r '.code // empty' 2>/dev/null || true)
if [ -z "${CODE}" ]; then
  echo "https-invite: createInviteCode failed: $(echo "${RESULT}" | jq -r '((.error // "") + " " + (.message // ""))' 2>/dev/null || echo "no JSON answer")" >&2
  exit 1
fi

touch "${FILE}"
make_private "${FILE}"
echo "${VAR}=${CODE}" | env_put "${FILE}" "^${VAR}="
unset CODE RESULT
echo "Wrote ${VAR} to ${FILE}: an alpha invite code, ${USES} uses" >&2
