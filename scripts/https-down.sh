#!/bin/sh
set -eu

# Stop the https devnet (spike). Only the devnet-https project is touched; the http
# devnet keeps running.
#
# Usage: ./scripts/https-down.sh [-v]
#   -v  also drop its volumes (PLC and PDS data). Then also delete
#       data/https/accounts.env, authority.env and spike-account.did, which name
#       accounts that no longer exist. The CA in data/https stays either way.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

docker compose -p devnet-https -f "${ROOT_DIR}/docker-compose.https.yml" down "$@"
