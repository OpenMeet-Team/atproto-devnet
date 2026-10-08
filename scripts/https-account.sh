#!/bin/sh
set -eu

# Create (or find) an account on one of the https devnet's PDSes, and keep its login in
# an accounts file as <PREFIX>_HANDLE, <PREFIX>_DID, <PREFIX>_PASSWORD and <PREFIX>_PDS.
# Prints the DID alone on stdout, and nothing secret anywhere. A rerun finds the account.
#
# Usage: ./scripts/https-account.sh <name> <PREFIX> [alpha|regular|prod]
#   <name>    the handle's first label: <name>.devnet.test on the alpha (the default),
#             <name>.regular.devnet.test or <name>.prod.devnet.test on the others
#   <PREFIX>  the variable prefix, e.g. MYAPP_OWNER
#
# Env: ACCOUNTS_FILE (default data/accounts.env; kept mode 600). The alpha requires an
# invite code: DEVNET_INVITE_CODE from the environment, ACCOUNTS_FILE or data/accounts.env
# (the base init makes one). The other two PDSes take none, and are sent none.
#
# The handle is added to data/https/names, so scripts/https-run maps it; restart a
# process running under https-run to pick a new one up. The password is generated
# here, written only to the accounts file, and sent only in the request body.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

usage() {
  echo "Usage: https-account.sh <name> <PREFIX> [alpha|regular|prod]" >&2
  exit 2
}
NAME="${1:-}"
PREFIX="${2:-}"
WHERE="${3:-alpha}"
[ -n "${NAME}" ] && [ -n "${PREFIX}" ] || usage
echo "${NAME}" | grep -qxE '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?' || {
  echo "https-account: <name> must be one lowercase DNS label: ${NAME}" >&2
  exit 2
}
echo "${PREFIX}" | grep -qxE '[A-Z][A-Z0-9_]*' || {
  echo "https-account: <PREFIX> must be an env var prefix (A-Z, 0-9, _): ${PREFIX}" >&2
  exit 2
}
PDS_NAME="$(pds_name "${WHERE}")" || usage
DOMAIN="$(pds_domain "${WHERE}")"
PDS="https://${PDS_NAME}"
HANDLE="${NAME}${DOMAIN}"
# On the alpha, these handles would be another PDS's name.
case "${WHERE}:${NAME}" in
  alpha:alpha | alpha:regular | alpha:prod)
    echo "https-account: ${HANDLE} is a PDS's name; pick another <name>" >&2
    exit 2
    ;;
esac

ACCOUNTS="${ACCOUNTS_FILE:-${DEVNET_ACCOUNTS}}"
touch "${ACCOUNTS}"
make_private "${ACCOUNTS}"

post() {
  devnet_curl "${PDS}/xrpc/$1" -X POST -H "Content-Type: application/json" --data-binary @-
}

save() {
  {
    echo "${PREFIX}_HANDLE=${HANDLE}"
    echo "${PREFIX}_DID=$1"
    echo "${PREFIX}_PASSWORD=$2"
    echo "${PREFIX}_PDS=${PDS}"
  } | env_put "${ACCOUNTS}" "^${PREFIX}_(HANDLE|DID|PASSWORD|PDS)="
}

SECRET="$(env_get "${PREFIX}_PASSWORD" "${ACCOUNTS}")"
if [ -n "${SECRET}" ] && [ "$(env_get "${PREFIX}_HANDLE" "${ACCOUNTS}")" = "${HANDLE}" ]; then
  DID=$(H="${HANDLE}" S="${SECRET}" jq -n '{identifier: env.H, password: env.S}' \
    | post com.atproto.server.createSession | jq -r '.did // empty' 2>/dev/null || true)
  if [ -n "${DID}" ]; then
    [ "$(env_get "${PREFIX}_DID" "${ACCOUNTS}")" = "${DID}" ] || save "${DID}" "${SECRET}"
    add_name "${HANDLE}"
    echo "Found ${HANDLE} -> ${DID}" >&2
    echo "${DID}"
    exit 0
  fi
  echo "${HANDLE} is in ${ACCOUNTS} but cannot sign in; creating it" >&2
fi

INVITE=""
if [ "${WHERE}" = alpha ]; then
  INVITE="${DEVNET_INVITE_CODE:-$(env_get DEVNET_INVITE_CODE "${ACCOUNTS}")}"
  [ -n "${INVITE}" ] || INVITE="$(env_get DEVNET_INVITE_CODE "${DEVNET_ACCOUNTS}")"
  if [ -z "${INVITE}" ]; then
    echo "https-account: the alpha needs an invite code, and there is no DEVNET_INVITE_CODE; has scripts/https-up.sh run?" >&2
    exit 1
  fi
fi

SECRET="$(openssl rand -hex 16)"
RESULT=$(H="${HANDLE}" S="${SECRET}" E="${NAME}@${DOMAIN#.}" I="${INVITE}" \
  jq -n '{handle: env.H, email: env.E, password: env.S} + (if env.I == "" then {} else {inviteCode: env.I} end)' \
  | post com.atproto.server.createAccount)
DID=$(echo "${RESULT}" | jq -r '.did // empty' 2>/dev/null || true)
if [ -z "${DID}" ]; then
  echo "https-account: createAccount ${HANDLE} on ${PDS} failed: $(echo "${RESULT}" | jq -r '((.error // "") + " " + (.message // ""))' 2>/dev/null || echo "${RESULT}" | head -c 200)" >&2
  exit 1
fi

save "${DID}" "${SECRET}"
add_name "${HANDLE}"
echo "Created ${HANDLE} on ${PDS} -> ${DID}" >&2
echo "${DID}"
