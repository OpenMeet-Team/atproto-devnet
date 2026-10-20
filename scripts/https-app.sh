#!/bin/sh
set -eu

# Route https://<name>.devnet.internal to a port on this machine, through the https
# devnet's nginx, for any app: its pages, its OAuth client metadata and its keys, at an
# https origin the devnet's PDSes and https-run's processes both reach.
#
# Usage: ./scripts/https-app.sh <name> <port> [<ending>]
#        ./scripts/https-app.sh --remove <name>
#   <name>    one lowercase DNS label; the app is https://<name>.devnet.internal
#   <port>    where the app listens on this machine. Listen on the address Docker's host
#             gateway lands on (host.docker.internal; the docker0 address here), or on
#             0.0.0.0, so nginx can reach it.
#   <ending>  for an app that hands out handles of its own, as a PDS does: one lowercase
#             DNS label. Every name under <ending>.<domain> (DEVNET_DOMAIN, devnet.test by
#             default) goes to the app too, so a handle there resolves at the app. The
#             leaf gains *.<ending>.<domain>, from the same CA, so nothing has to be
#             trusted again. The PDSes' names are their own; an ending is one app's.
#
# The route is kept in data/https/apps (a rerun with the same name changes its port, and
# drops its ending unless given again); data/https/nginx/ is rendered from it, and nginx
# in DEVNET_PROJECT's stack is reloaded (DEVNET_PROJECT defaults to the one
# data/devnet.env names). If the stack is down, the route is kept and nginx loads it when
# https-up.sh starts it.
#
# --remove drops <name>'s route (and its ending, if it claimed one), re-renders and reloads
# the same way, so a stopped app stops showing on the network page. The leaf keeps the
# ending's name; an extra name on a certificate is harmless.
#
# A name with no route gets a 404 from nginx and reaches nothing. Inside https-run the
# name resolves to 127.0.0.1; restart a process already running under it to pick up a
# new name.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

label() { echo "$1" | grep -qxE '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'; }
USAGE="Usage: https-app.sh <name> <port> [<ending>] | --remove <name>   (name, ending: one lowercase DNS label each)"

mkdir -p "${HTTPS_DIR}"
APPS="${HTTPS_DIR}/apps"
touch "${APPS}"

if [ "${1:-}" = --remove ]; then
  NAME="${2:-}"
  if ! label "${NAME}" || [ $# -ne 2 ]; then
    echo "${USAGE}" >&2
    exit 2
  fi
  if ! awk -v n="${NAME}" '$1 == n { found = 1 } END { exit !found }' "${APPS}"; then
    echo "https-app: no route named ${NAME} in data/https/apps; routed: $(awk '{ print $1 }' "${APPS}" | paste -sd ' ' -)" >&2
    exit 1
  fi
  awk -v n="${NAME}" '$1 != n' "${APPS}" > "${APPS}.tmp"
  mv "${APPS}.tmp" "${APPS}"
  render_apps
  echo "Removed https://${NAME}.devnet.internal (data/https/apps)" >&2
else
  NAME="${1:-}"
  PORT="${2:-}"
  ENDING="${3:-}"
  if ! label "${NAME}" || ! echo "${PORT}" | grep -qxE '[1-9][0-9]{0,4}' || [ "${PORT}" -gt 65535 ] \
     || { [ -n "${ENDING}" ] && ! label "${ENDING}"; } || [ $# -gt 3 ]; then
    echo "${USAGE}" >&2
    exit 2
  fi
  if [ -n "${ENDING}" ]; then
    for _p in $(globe_pds); do
      if [ "${ENDING}" = "${_p}" ]; then
        echo "https-app: ${ENDING}.${DEVNET_DOMAIN} is a PDS's own" >&2
        exit 1
      fi
    done
    OWNER="$(awk -v n="${NAME}" -v e="${ENDING}" '$1 != n && $3 == e { print $1; exit }' "${APPS}")"
    if [ -n "${OWNER}" ]; then
      echo "https-app: handles under ${ENDING}.${DEVNET_DOMAIN} already go to ${OWNER} (data/https/apps)" >&2
      exit 1
    fi
  fi
  { awk -v n="${NAME}" '$1 != n' "${APPS}"; echo "${NAME} ${PORT}${ENDING:+ ${ENDING}}"; } > "${APPS}.tmp"
  mv "${APPS}.tmp" "${APPS}"
  # The CA is kept, and a new leaf is written over the old file, which nginx's mount follows.
  NEW_CERTS=""
  if leaf_lacks; then
    node "${SCRIPT_DIR}/snowglobe" certs
    NEW_CERTS=1
  fi
  render_apps
  echo "https://${NAME}.devnet.internal -> port ${PORT} on this machine (data/https/apps)" >&2
  [ -z "${ENDING}" ] || echo "https://<handle>.${ENDING}.${DEVNET_DOMAIN} -> the same port" >&2
fi

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
# A reload rereads the certificate too.
dc exec -T nginx nginx -s reload
echo "Reloaded nginx in ${DEVNET_PROJECT}${NEW_CERTS:+, with the new leaf}" >&2
