#!/bin/sh
set -eu

# Bring up the https devnet (spike) as its own compose project, devnet-https, and
# seed it. Safe to rerun: each step keeps what an earlier run made.
#
# Usage: ./scripts/https-up.sh
#
#   1. scripts/https-ca.sh, if data/https has no certificates yet
#   2. data/https/db.env and pds.env: generated database and PDS credentials, made once
#   3. first pass: up, without a lexicon authority
#   4. the lexicon authority account, its DID into data/https/authority.env, and a
#      second `up`, which recreates the PDS with PDS_LEXICON_AUTHORITY_DID
#   5. scripts/https-seed.sh: the permission sets and the spike account
#
# It runs compose only with -p devnet-https, so the http devnet's project is never
# touched. Nothing secret is printed.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA="${ROOT_DIR}/data/https"
cd "${ROOT_DIR}"

dc() { docker compose -p devnet-https -f "${ROOT_DIR}/docker-compose.https.yml" "$@"; }

mkdir -p "${DATA}"

NEW_CERTS=""
if [ ! -f "${DATA}/ca.crt" ] || [ ! -f "${DATA}/leaf.crt" ] || [ ! -f "${DATA}/leaf.key" ]; then
  "${SCRIPT_DIR}/https-ca.sh"
  NEW_CERTS=1
fi

# db.env goes to postgres and the PLC, pds.env to the PDS alone. A stack.env from an
# earlier version of this script is split into the two, keeping its values.
if [ ! -f "${DATA}/db.env" ] || [ ! -f "${DATA}/pds.env" ]; then
  (
    umask 077
    if [ -f "${DATA}/stack.env" ]; then
      grep '^POSTGRES_' "${DATA}/stack.env" > "${DATA}/db.env"
      grep '^PDS_' "${DATA}/stack.env" > "${DATA}/pds.env"
      rm "${DATA}/stack.env"
    else
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > "${DATA}/db.env"
      {
        echo "PDS_ADMIN_PASSWORD=$(openssl rand -hex 16)"
        echo "PDS_JWT_SECRET=$(openssl rand -hex 32)"
        echo "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=$(openssl rand -hex 32)"
      } > "${DATA}/pds.env"
    fi
  )
  echo "Wrote ${DATA}/db.env and pds.env (generated credentials)" >&2
fi

echo "Pass 1: up" >&2
dc up -d --wait
# A running nginx keeps the certificate files it started with; new ones need a restart.
if [ -n "${NEW_CERTS}" ]; then
  dc restart nginx
fi

AUTH_DID=$("${SCRIPT_DIR}/https-account.sh" lex-authority LEX_AUTHORITY)
if [ "$(sed -n 's/^PDS_LEXICON_AUTHORITY_DID=//p' "${DATA}/authority.env" 2>/dev/null)" != "${AUTH_DID}" ]; then
  echo "PDS_LEXICON_AUTHORITY_DID=${AUTH_DID}" > "${DATA}/authority.env"
  echo "Pass 2: up with the lexicon authority ${AUTH_DID}" >&2
  dc up -d --wait
fi

"${SCRIPT_DIR}/https-seed.sh"

echo >&2
dc ps --format '{{.Service}} {{.State}} {{.Ports}}' >&2
