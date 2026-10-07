#!/bin/sh
set -eu

# Bring up the https devnet (spike) as its own compose project, devnet-https, and
# seed it. Safe to rerun: each step keeps what an earlier run made.
#
# Usage: ./scripts/https-up.sh
#
#   1. scripts/https-ca.sh, if data/https has no certificates yet
#   2. data/https/stack.env: generated database and PDS credentials, made once
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

if [ ! -f "${DATA}/ca.crt" ] || [ ! -f "${DATA}/leaf.crt" ] || [ ! -f "${DATA}/leaf.key" ]; then
  "${SCRIPT_DIR}/https-ca.sh"
fi

if [ ! -f "${DATA}/stack.env" ]; then
  (
    umask 077
    {
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
      echo "PDS_ADMIN_PASSWORD=$(openssl rand -hex 16)"
      echo "PDS_JWT_SECRET=$(openssl rand -hex 32)"
      echo "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=$(openssl rand -hex 32)"
    } > "${DATA}/stack.env"
  )
  echo "Wrote ${DATA}/stack.env (generated credentials)" >&2
fi

echo "Pass 1: up" >&2
dc up -d --wait

AUTH_DID=$("${SCRIPT_DIR}/https-account.sh" lex-authority LEX_AUTHORITY)
if [ "$(sed -n 's/^PDS_LEXICON_AUTHORITY_DID=//p' "${DATA}/authority.env" 2>/dev/null)" != "${AUTH_DID}" ]; then
  echo "PDS_LEXICON_AUTHORITY_DID=${AUTH_DID}" > "${DATA}/authority.env"
  echo "Pass 2: up with the lexicon authority ${AUTH_DID}" >&2
  dc up -d --wait
fi

"${SCRIPT_DIR}/https-seed.sh"

echo >&2
dc ps --format '{{.Service}} {{.State}} {{.Ports}}' >&2
