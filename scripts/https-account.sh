#!/bin/sh
set -eu

# Create (or find) an account on the https devnet's PDS, and keep its login in
# data/https/accounts.env as <PREFIX>_HANDLE, <PREFIX>_DID, <PREFIX>_PASSWORD and
# <PREFIX>_PDS. Prints the DID on stdout and nothing secret anywhere.
#
# Usage: ./scripts/https-account.sh <name> <PREFIX>
#   <name>    the handle's first label; the handle is <name>.https.devnet.test
#   <PREFIX>  the variable prefix, e.g. SPIKEOWNER
#
# The PDS needs no invite code (PDS_INVITE_REQUIRED=false). The sign-in secret is
# generated here, written only to accounts.env, and sent in the request body.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="${SCRIPT_DIR}/../data/https"
PDS_NAME=pds.https.devnet.test
PDS="https://${PDS_NAME}"
ACCOUNTS="${DATA}/accounts.env"

NAME="${1:?Usage: https-account.sh <name> <PREFIX>}"
PREFIX="${2:?Usage: https-account.sh <name> <PREFIX>}"
HANDLE="${NAME}.https.devnet.test"

# TLS is verified against the devnet CA; the name goes to nginx on 127.0.0.1.
pds() {
  curl -sS --resolve "${PDS_NAME}:443:127.0.0.1" --cacert "${DATA}/ca.crt" \
    -X POST -H "Content-Type: application/json" --data-binary @- "${PDS}/xrpc/$1"
}

touch "${ACCOUNTS}"
chmod 600 "${ACCOUNTS}"
saved() { sed -n "s/^${PREFIX}_$1=//p" "${ACCOUNTS}" | tail -1; }

SECRET="$(saved PASSWORD)"
if [ -n "${SECRET}" ]; then
  DID=$(H="${HANDLE}" S="${SECRET}" jq -n '{identifier: env.H, password: env.S}' \
    | pds com.atproto.server.createSession | jq -r '.did // empty')
  if [ -n "${DID}" ]; then
    echo "Found ${HANDLE} -> ${DID}" >&2
    echo "${DID}"
    exit 0
  fi
  echo "${HANDLE} is in accounts.env but cannot sign in; creating it again" >&2
fi

SECRET="$(openssl rand -hex 16)"
RESULT=$(H="${HANDLE}" S="${SECRET}" E="${NAME}@https.devnet.test" \
  jq -n '{handle: env.H, email: env.E, password: env.S}' | pds com.atproto.server.createAccount)
DID=$(echo "${RESULT}" | jq -r '.did // empty')
if [ -z "${DID}" ]; then
  echo "createAccount ${HANDLE} failed: $(echo "${RESULT}" | jq -r '(.error // "") + " " + (.message // "")')" >&2
  exit 1
fi

# Replace this prefix's lines, keep everyone else's.
grep -v "^${PREFIX}_" "${ACCOUNTS}" > "${ACCOUNTS}.tmp" || true
{
  echo "${PREFIX}_HANDLE=${HANDLE}"
  echo "${PREFIX}_DID=${DID}"
  echo "${PREFIX}_PASSWORD=${SECRET}"
  echo "${PREFIX}_PDS=${PDS}"
} >> "${ACCOUNTS}.tmp"
mv "${ACCOUNTS}.tmp" "${ACCOUNTS}"
chmod 600 "${ACCOUNTS}"

echo "Created ${HANDLE} -> ${DID}" >&2
echo "${DID}"
