#!/bin/sh
set -eu

# Guard, before anything else: the project is always named, and the shared devnet is
# never touched by accident.
if [ -z "${DEVNET_PROJECT:-}" ]; then
  echo "https-down: set DEVNET_PROJECT to the compose project to stop (there is no default)" >&2
  exit 2
fi
if [ "${DEVNET_PROJECT}" = devnet-spaces ] && [ "${DEVNET_RESET_OK:-}" != 1 ]; then
  echo "https-down: refusing devnet-spaces, the shared devnet; set DEVNET_RESET_OK=1 only for a planned reset" >&2
  exit 3
fi

# Stop the https devnet's project DEVNET_PROJECT. Every argument goes to
# `docker compose down`, with the same six files https-up.sh uses.
#
# Usage: DEVNET_PROJECT=<project> ./scripts/https-down.sh [-v]
#   -v  also drop the project's volumes: every account, DID and record is gone. The PLC's
#       database is a named volume, so without -v the DIDs survive with the PDSes.
#
# data/ is never deleted. After -v, the logins in data/accounts.env name accounts that no
# longer exist; the next https-up.sh starts them over (the base init reseeds alice and
# bob, and the lexicon authority is made again). The CA, the leaf and the app routes in
# data/https stay either way.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

dc down "$@"
