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

# Bring up the https devnet: the globe a snowglobe.yml describes, as compose project
# DEVNET_PROJECT. Safe to rerun: each step keeps what an earlier run made, and a rerun is
# one `up`.
#
# Usage: DEVNET_PROJECT=<project> [SNOWGLOBE_FILE=<snowglobe.yml>] ./scripts/https-up.sh
#
#   1. scripts/snowglobe render: data/globe/ from SNOWGLOBE_FILE, or the default globe
#      (snowglobe.default.yml: alpha, regular and prod). DEVNET_DOMAIN, from the
#      environment or .env, replaces the file's domain.
#   2. scripts/snowglobe certs, if data/https has no leaf yet, or it lacks a name (the CA is kept)
#   3. nginx's app routes, from data/https/apps (scripts/https-app.sh)
#   4. pass 1: up. The base init seeds alice, bob and DEVNET_INVITE_CODE into
#      data/accounts.env on the PDS with bare handles (else the first), as it does for the
#      http stacks.
#   5. the lexicon authority, lex-authority on the file's lexicons.authority PDS
#      (LEX_AUTHORITY_* in data/accounts.env), then pass 2: up with
#      DEVNET_LEXICON_AUTHORITY_DID, which recreates the PDSes with it
#   6. data/devnet.env: the devnet's URLs and the authority's DID and handle, nothing
#      secret, for an app to source
#
# It seeds no app's data: an app makes its own accounts, invite codes and lexicons with
# scripts/snowglobe account, invite and lexicons. Nothing secret is
# printed. The tool ports come from the usual variables (DEVNET_PLC_PORT,
# DEVNET_JETSTREAM_PORT, DEVNET_JETSTREAM_METRICS_PORT, DEVNET_MAILDEV_WEB_PORT,
# DEVNET_MAILDEV_SMTP_PORT, DEVNET_PROXY_PORT); pass the same ones on every run.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# A render from an earlier run may be for another domain; this one replaces it.
SNOWGLOBE_RENDER=1
. "${SCRIPT_DIR}/https-lib.sh"

# A PDS by the name of an app's handle ending would take that app's handles: nginx keeps the
# first of two servers with one name, and the globe's come before the apps'. Checked on a render
# aside, so a refused file leaves data/globe/ as the running globe has it.
_ahead="$(mktemp -d)"
render_globe "${_ahead}/globe"
for _p in $(env_get SNOWGLOBE_PDS "${_ahead}/globe/globe.env"); do
  _app="$(awk -v e="${_p}" '$3 == e { print $1; exit }' "${HTTPS_DIR}/apps" 2>/dev/null || true)"
  if [ -n "${_app}" ]; then
    rm -rf "${_ahead}"
    echo "https-up: the PDS ${_p} would take the handles under ${_p}.<domain>, the ending app ${_app} claimed; rename the PDS, or scripts/https-app.sh --remove ${_app}" >&2
    exit 1
  fi
done
rm -rf "${_ahead}"
render_globe
mkdir -p "${HTTPS_DIR}/nginx"

# The leaf must carry every name (scripts/snowglobe-certs.mjs): a leaf from before the app routes lacks
# *.devnet.internal, and one from before an app claimed a handle ending lacks its wildcard.
NEW_CERTS=""
if leaf_lacks; then
  node "${SCRIPT_DIR}/snowglobe" certs
  NEW_CERTS=1
fi

render_apps

# `up --wait` alone fails as soon as a one-shot service exits, even with 0. So: up, then
# wait for the one-shots (init seeds data/accounts.env; relay-init registers every PDS with
# the relay), then for every long-running service to be healthy.
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
  # A service the file no longer runs (a PDS taken out, a service turned off) is stopped.
  dc up -d --remove-orphans
  for _s in $(env_get SNOWGLOBE_ONESHOTS "${GLOBE_ENV}"); do
    wait_done "${_s}"
  done
  # shellcheck disable=SC2046 # service names, one word each
  dc up -d --wait $(env_get SNOWGLOBE_SERVICES "${GLOBE_ENV}")
}

# What runs before this run: the relay, and every container, to notice a PDS this run makes.
_relay_before="$(dc ps -q relay 2>/dev/null || true)"
_before="$(dc ps -aq 2>/dev/null || true)"

# A rerun starts the PDSes with the authority they already have, so pass 1 changes nothing.
DEVNET_LEXICON_AUTHORITY_DID="$(env_get LEX_AUTHORITY_DID "${DEVNET_ACCOUNTS}")"
export DEVNET_LEXICON_AUTHORITY_DID

echo "Pass 1: up (project ${DEVNET_PROJECT})" >&2
up_stack
# A running nginx keeps the certificate files it started with; new ones need a restart. The
# globe's servers may have changed with the render, so a running nginx reloads them.
if [ -n "${NEW_CERTS}" ]; then
  dc restart nginx >/dev/null
else
  dc exec -T nginx nginx -s reload >/dev/null
fi

AUTH_DID=$(node "${SCRIPT_DIR}/snowglobe" account lex-authority LEX_AUTHORITY "$(env_get SNOWGLOBE_AUTHORITY_PDS "${GLOBE_ENV}")")
if [ "${AUTH_DID}" != "${DEVNET_LEXICON_AUTHORITY_DID}" ]; then
  DEVNET_LEXICON_AUTHORITY_DID="${AUTH_DID}"
  echo "Pass 2: up with the lexicon authority ${AUTH_DID}" >&2
  up_stack
fi

# A relay that was running when a PDS went away redials it with a growing backoff; a PDS added
# back under that name was not crawled again until the relay restarted (2026-10-20: no dial in
# the nine minutes after it came back). So when this run made a PDS container beside a
# relay that was already running, the relay restarts, and the services wait for it again.
if [ -n "${_relay_before}" ]; then
  for _p in $(globe_pds); do
    if ! printf '%s\n' "${_before}" | grep -qxF "$(dc ps -q "pds-${_p}")"; then
      echo "Restarting the relay: pds-${_p} is new beside it" >&2
      dc restart relay >/dev/null
      # shellcheck disable=SC2046 # service names, one word each
      dc up -d --wait $(env_get SNOWGLOBE_SERVICES "${GLOBE_ENV}")
      break
    fi
  done
fi

# init's accounts are on the seed PDS; https-run maps their handles.
for prefix in ALICE BOB; do
  handle="$(env_get "${prefix}_HANDLE" "${DEVNET_ACCOUNTS}")"
  [ -z "${handle}" ] || add_name "${handle}"
done

DENV="${DATA_DIR}/devnet.env"
{
  echo "# The https devnet's own facts, written by scripts/https-up.sh. Nothing secret:"
  echo "# logins are in data/accounts.env. Run clients under scripts/https-run."
  echo "DEVNET_PROJECT=${DEVNET_PROJECT}"
  echo "DEVNET_DOMAIN=${DEVNET_DOMAIN}"
  echo "PAGE_URL=https://${DEVNET_DOMAIN}/"
  # <NAME>_PDS_URL for each PDS: ALPHA_PDS_URL for alpha. A shell name cannot start with a
  # digit, so a PDS named 1st is _1ST_PDS_URL.
  for _p in $(globe_pds); do
    _v="$(printf '%s' "${_p}" | tr 'a-z-' 'A-Z_')"
    case "${_v}" in [0-9]*) _v="_${_v}" ;; esac
    echo "${_v}_PDS_URL=https://${_p}.${DEVNET_DOMAIN}"
  done
  echo "PLC_URL=https://plc.directory"
  echo "JETSTREAM_URL=ws://127.0.0.1:${DEVNET_JETSTREAM_PORT:-6008}"
  echo "MAILDEV_URL=http://127.0.0.1:${DEVNET_MAILDEV_WEB_PORT:-1081}"
  echo "PROXY_PAC_URL=http://127.0.0.1:${DEVNET_PROXY_PORT:-1080}/proxy.pac"
  echo "LEX_AUTHORITY_DID=${AUTH_DID}"
  echo "LEX_AUTHORITY_HANDLE=$(env_get LEX_AUTHORITY_HANDLE "${DEVNET_ACCOUNTS}")"
  echo "DEVNET_CA_FILE=${CA}"
  echo "DEVNET_BIND=${DEVNET_BIND}"
} > "${DENV}.tmp"
mv "${DENV}.tmp" "${DENV}"
echo "Wrote ${DENV}" >&2

# init leaves data/accounts.env and data/accounts.json world-readable on every up; both hold logins.
make_private "${DEVNET_ACCOUNTS}"
make_private "${DATA_DIR}/accounts.json"

echo >&2
dc ps --format '{{.Service}} {{.State}} {{.Ports}}' >&2
