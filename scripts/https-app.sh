#!/bin/sh
set -eu

# Route https://<name>.devnet.internal to a port on this machine, through the https
# devnet's nginx, for any app: its pages, its OAuth client metadata and its keys, at an
# https origin the devnet's PDSes and https-run's processes both reach.
#
# Usage: ./scripts/https-app.sh <name> <port>
#   <name>  one lowercase DNS label; the app is https://<name>.devnet.internal
#   <port>  where the app listens on this machine. Listen on the address Docker's host
#           gateway lands on (host.docker.internal; the docker0 address here), or on
#           0.0.0.0, so nginx can reach it.
#
# The route is kept in data/https/apps (a rerun with the same name changes its port);
# data/https/nginx/ is rendered from it, and nginx in DEVNET_PROJECT's stack is
# reloaded (DEVNET_PROJECT defaults to the one data/devnet.env names). If the stack is
# down, the route is kept and nginx loads it when https-up.sh starts it.
#
# A name with no route gets a 404 from nginx and reaches nothing. Inside https-run the
# name resolves to 127.0.0.1; restart a process already running under it to pick up a
# new name.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

NAME="${1:-}"
PORT="${2:-}"
if ! echo "${NAME}" | grep -qxE '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?' || ! echo "${PORT}" | grep -qxE '[1-9][0-9]{0,4}' || [ "${PORT}" -gt 65535 ]; then
  echo "Usage: https-app.sh <name> <port>   (name: one lowercase DNS label)" >&2
  exit 2
fi

mkdir -p "${HTTPS_DIR}"
APPS="${HTTPS_DIR}/apps"
touch "${APPS}"
{ awk -v n="${NAME}" '$1 != n' "${APPS}"; echo "${NAME} ${PORT}"; } > "${APPS}.tmp"
mv "${APPS}.tmp" "${APPS}"
render_apps
echo "https://${NAME}.devnet.internal -> port ${PORT} on this machine (data/https/apps)" >&2

DEVNET_PROJECT="${DEVNET_PROJECT:-$(env_get DEVNET_PROJECT "${DATA_DIR}/devnet.env")}"
if [ -z "${DEVNET_PROJECT}" ]; then
  echo "No DEVNET_PROJECT and no data/devnet.env; nginx loads the route when https-up.sh starts the stack" >&2
  exit 0
fi
if [ -z "$(dc ps -q --status running nginx 2>/dev/null)" ]; then
  echo "nginx is not running in ${DEVNET_PROJECT}; it loads the route when https-up.sh starts it" >&2
  exit 0
fi
if ! dc exec -T nginx nginx -t -q; then
  echo "https-app: nginx refused the new routes; data/https/nginx/ holds what it read" >&2
  exit 1
fi
dc exec -T nginx nginx -s reload
echo "Reloaded nginx in ${DEVNET_PROJECT}" >&2
