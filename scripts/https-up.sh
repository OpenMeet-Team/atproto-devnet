#!/bin/sh
set -eu

# Guard, before anything else: the project is always named, and the shared devnet is
# never touched by accident.
if [ -z "${DEVNET_PROJECT:-}" ]; then
  echo "https-up: set DEVNET_PROJECT to the compose project to bring up (there is no default)" >&2
  exit 2
fi
if [ "${DEVNET_PROJECT}" = devnet-spaces ] && [ "${DEVNET_RESET_OK:-}" != 1 ]; then
  echo "https-up: refusing devnet-spaces, the shared devnet; set DEVNET_RESET_OK=1 only for a planned reset" >&2
  exit 3
fi

# Bring up the https devnet: the five spaces compose files plus docker-compose.https.yml,
# as compose project DEVNET_PROJECT. Safe to rerun: each step keeps what an earlier run
# made, and a rerun is one `up`.
#
# Usage: DEVNET_PROJECT=<project> ./scripts/https-up.sh
#
#   1. scripts/https-ca.sh, if data/https has no leaf yet (the CA is kept)
#   2. nginx's app routes, from data/https/apps (scripts/https-app.sh)
#   3. pass 1: up. The base init seeds alice, bob and DEVNET_INVITE_CODE into
#      data/accounts.env, as it does for the http stacks.
#   4. the lexicon authority, lex-authority.devnet.test on the alpha (LEX_AUTHORITY_* in
#      data/accounts.env), then pass 2: up with DEVNET_LEXICON_AUTHORITY_DID, which
#      recreates the PDSes (and what shares their network) with it
#   5. data/devnet.env: the devnet's URLs and the authority's DID and handle, nothing
#      secret, for an app to source
#
# It seeds no app's data: an app makes its own accounts, invite codes and lexicons with
# scripts/https-account.sh, https-invite.sh and https-lexicons.sh. Nothing secret is
# printed. The tool ports come from the usual variables (DEVNET_PLC_PORT,
# DEVNET_JETSTREAM_PORT, DEVNET_JETSTREAM_METRICS_PORT, DEVNET_MAILDEV_WEB_PORT,
# DEVNET_MAILDEV_SMTP_PORT); pass the same ones on every run.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

mkdir -p "${HTTPS_DIR}/nginx"

# The leaf must name *.devnet.internal, which a leaf from before the app routes lacks.
NEW_CERTS=""
if [ ! -f "${HTTPS_DIR}/leaf.crt" ] || [ ! -f "${HTTPS_DIR}/leaf.key" ] \
   || ! openssl x509 -in "${HTTPS_DIR}/leaf.crt" -noout -ext subjectAltName 2>/dev/null | grep -qF 'DNS:*.devnet.internal'; then
  "${SCRIPT_DIR}/https-ca.sh"
  NEW_CERTS=1
fi

render_apps

# `up --wait` alone fails as soon as a one-shot service exits, even with 0. So: up, then
# wait for the one-shots (init seeds data/accounts.env; relay-init registers the three
# PDSes with the relay), then for every long-running service to be healthy.
wait_done() {
  _n=0
  while :; do
    _st=$(dc ps -a --format '{{.State}} {{.ExitCode}}' "$1" 2>/dev/null | head -1)
    case "${_st}" in
      "exited 0") return 0 ;;
      exited*)
        echo "https-up: $1 failed (exit ${_st#exited })" >&2
        return 1
        ;;
    esac
    _n=$((_n + 1))
    if [ "${_n}" -ge 300 ]; then
      echo "https-up: $1 did not finish within 300 s" >&2
      return 1
    fi
    sleep 1
  done
}
up_stack() {
  dc up -d
  wait_done init
  wait_done relay-init
  dc up -d --wait postgres plc maildev pds pds-regular pds-prod nginx relay jetstream tap
}

# A rerun starts the PDSes with the authority they already have, so pass 1 changes nothing.
DEVNET_LEXICON_AUTHORITY_DID="$(env_get LEX_AUTHORITY_DID "${DEVNET_ACCOUNTS}")"
export DEVNET_LEXICON_AUTHORITY_DID

echo "Pass 1: up (project ${DEVNET_PROJECT})" >&2
up_stack
# A running nginx keeps the certificate files it started with; new ones need a restart.
if [ -n "${NEW_CERTS}" ]; then
  dc restart nginx >/dev/null
fi

AUTH_DID=$("${SCRIPT_DIR}/https-account.sh" lex-authority LEX_AUTHORITY alpha)
if [ "${AUTH_DID}" != "${DEVNET_LEXICON_AUTHORITY_DID}" ]; then
  DEVNET_LEXICON_AUTHORITY_DID="${AUTH_DID}"
  echo "Pass 2: up with the lexicon authority ${AUTH_DID}" >&2
  # The whole stack: recreating pds alone strands the services in its network namespace.
  up_stack
fi

# init's accounts are on the alpha too; https-run maps their handles.
for prefix in ALICE BOB; do
  handle="$(env_get "${prefix}_HANDLE" "${DEVNET_ACCOUNTS}")"
  [ -z "${handle}" ] || add_name "${handle}"
done

DENV="${DATA_DIR}/devnet.env"
{
  echo "# The https devnet's own facts, written by scripts/https-up.sh. Nothing secret:"
  echo "# logins are in data/accounts.env. Run clients under scripts/https-run."
  echo "DEVNET_PROJECT=${DEVNET_PROJECT}"
  echo "ALPHA_PDS_URL=https://$(pds_name alpha)"
  echo "REGULAR_PDS_URL=https://$(pds_name regular)"
  echo "PROD_PDS_URL=https://$(pds_name prod)"
  echo "PLC_URL=https://plc.directory"
  echo "JETSTREAM_URL=ws://127.0.0.1:${DEVNET_JETSTREAM_PORT:-6008}"
  echo "MAILDEV_URL=http://127.0.0.1:${DEVNET_MAILDEV_WEB_PORT:-1081}"
  echo "LEX_AUTHORITY_DID=${AUTH_DID}"
  echo "LEX_AUTHORITY_HANDLE=$(env_get LEX_AUTHORITY_HANDLE "${DEVNET_ACCOUNTS}")"
  echo "DEVNET_CA_FILE=${CA}"
} > "${DENV}.tmp"
mv "${DENV}.tmp" "${DENV}"
echo "Wrote ${DENV}" >&2

# init leaves data/accounts.env world-readable on every up; it holds logins.
make_private "${DEVNET_ACCOUNTS}"

echo >&2
dc ps --format '{{.Service}} {{.State}} {{.Ports}}' >&2
