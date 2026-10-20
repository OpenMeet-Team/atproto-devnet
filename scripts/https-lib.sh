# Shared by the scripts/https-* tools; sourced, not run. Paths, the compose command for
# the https devnet, curl to a devnet name, and private env files. Nothing here prints a
# secret.
#
# The devnet is the globe a snowglobe.yml describes, rendered into data/globe/ by
# scripts/snowglobe render (render_globe, which https-up.sh runs): its compose file, nginx's
# servers, the leaf's names and globe.env, the facts read here.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${ROOT_DIR}/data"
HTTPS_DIR="${DATA_DIR}/https"
CA="${HTTPS_DIR}/ca.crt"
# The devnet's own logins (the base init's alice, bob and invite code, the lexicon
# authority, and accounts made by scripts/snowglobe account).
DEVNET_ACCOUNTS="${DATA_DIR}/accounts.env"
# The rendered globe. Nothing in it is secret.
GLOBE_DIR="${DATA_DIR}/globe"
GLOBE_ENV="${GLOBE_DIR}/globe.env"

# The three PDSes: short name, https name, handle domain. Each is under DEVNET_DOMAIN
# (set below), devnet.test by default.
pds_name() {
  case "$1" in
    alpha | regular | prod) echo "$1.${DEVNET_DOMAIN}" ;;
    *) return 1 ;;
  esac
}
pds_domain() {
  case "$1" in
    alpha) echo ".${DEVNET_DOMAIN}" ;;
    regular | prod) echo ".$1.${DEVNET_DOMAIN}" ;;
    *) return 1 ;;
  esac
}

# docker compose on DEVNET_PROJECT with the rendered globe. Its paths are from the repo root,
# which is also where compose reads .env.
dc() {
  if [ ! -f "${GLOBE_DIR}/compose.yml" ]; then
    echo "No ${GLOBE_DIR}/compose.yml: run scripts/https-up.sh, which renders it" >&2
    return 1
  fi
  docker compose -p "${DEVNET_PROJECT}" --project-directory "${ROOT_DIR}" \
    -f "${GLOBE_DIR}/compose.yml" "$@"
}

# globe_pds: the globe's PDSes, by name, space-separated.
globe_pds() {
  env_get SNOWGLOBE_PDS "${GLOBE_ENV}"
}

# render_globe [<dir>]: write the globe from SNOWGLOBE_FILE, or the default globe, with the
# domain from the environment or .env when one is set there, into data/globe/; DEVNET_DOMAIN is
# then the globe's. With <dir>, into that folder instead, to look at before data/globe/ changes.
render_globe() {
  node "${ROOT_DIR}/scripts/snowglobe" render "${SNOWGLOBE_FILE:-${ROOT_DIR}/snowglobe.default.yml}" \
    --out "${1:-${GLOBE_DIR}}" ${DEVNET_DOMAIN_SET:+--domain "${DEVNET_DOMAIN_SET}"} >&2
  [ -n "${1:-}" ] || DEVNET_DOMAIN="$(env_get DEVNET_DOMAIN "${GLOBE_ENV}")"
}

# curl <https URL on a devnet name> [curl args...]: the name goes to nginx on
# 127.0.0.1, and TLS is verified against the devnet CA. With DEVNET_PUBLIC=1 the names
# are public ones with a real certificate (a globe on the cluster), so the URL is used
# as it stands, through public DNS and the system's CAs.
devnet_curl() {
  _url="$1"
  shift
  if [ "${DEVNET_PUBLIC:-}" = 1 ]; then
    curl -sS "$@" "${_url}"
    return
  fi
  _host=$(printf '%s\n' "${_url}" | sed -E 's#^https://([^/:]+).*#\1#')
  curl -sS --resolve "${_host}:443:${DEVNET_BIND:-127.0.0.1}" --cacert "${CA}" "$@" "${_url}"
}

# env_get <NAME> <file>: the last value of NAME in an env file, or nothing.
env_get() {
  [ -f "$2" ] || return 0
  sed -n "s/^$1=//p" "$2" | tail -1
}

# env_compose <NAME> <file>: NAME's last value in an env file, read as compose reads
# it: an export prefix, quotes, a trailing " # comment" and a CRLF line end are allowed.
env_compose() {
  [ -f "$2" ] || return 0
  sed -n -E "s/\\r\$//; s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*//p" "$2" |
    tail -1 |
    sed -E "s/^\"([^\"]*)\".*/\1/; t; s/^'([^']*)'.*/\1/; t; s/[[:space:]]+#.*//; s/[[:space:]]+\$//"
}

# The domain every devnet name sits under: set in the environment (even empty), that wins;
# else .env; else the rendered globe's, which is the file's unless one of those replaced it
# (render_globe); empty means devnet.test. A setting that differs from the rendered globe's
# means the render is stale, so it is refused until https-up.sh renders again
# (SNOWGLOBE_RENDER=1 there).
if [ -z "${DEVNET_DOMAIN+set}" ]; then
  DEVNET_DOMAIN="$(env_compose DEVNET_DOMAIN "${ROOT_DIR}/.env")"
fi
DEVNET_DOMAIN_SET="${DEVNET_DOMAIN}"
_globe_domain="$(env_get DEVNET_DOMAIN "${GLOBE_ENV}")"
if [ -n "${DEVNET_DOMAIN}" ] && [ -n "${_globe_domain}" ] && [ "${DEVNET_DOMAIN}" != "${_globe_domain}" ] \
   && [ -z "${SNOWGLOBE_RENDER:-}" ]; then
  echo "DEVNET_DOMAIN=${DEVNET_DOMAIN}, but the globe in data/globe/ was rendered for ${_globe_domain}; run scripts/https-up.sh" >&2
  exit 1
fi
DEVNET_DOMAIN="${DEVNET_DOMAIN:-${_globe_domain:-devnet.test}}"
# A domain name and nothing else. This also refuses ${...} in .env, which compose would
# expand and these scripts do not.
case "${DEVNET_DOMAIN}" in
  *[!A-Za-z0-9.-]* | .* | *. | *..*)
    echo "DEVNET_DOMAIN=${DEVNET_DOMAIN} is not a domain name (set in the environment or .env)" >&2
    exit 1
    ;;
esac

# The address nginx publishes 443 on, worked out as compose works out
# ${DEVNET_BIND:-127.0.0.1}, so devnet_curl and https-run's hosts file go where compose
# published it. A loopback address only (127.x.y.z, one per devnet run side by side): the
# devnet's logins are throwaway, so it is never published beyond this machine.
if [ -z "${DEVNET_BIND+set}" ]; then
  DEVNET_BIND="$(env_compose DEVNET_BIND "${ROOT_DIR}/.env")"
fi
DEVNET_BIND="${DEVNET_BIND:-127.0.0.1}"
if ! printf '%s\n' "${DEVNET_BIND}" | awk -F. '
  NF != 4 || $1 != "127" { exit 1 }
  { for (i = 2; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i > 255) exit 1 }'; then
  echo "DEVNET_BIND=${DEVNET_BIND} is not a loopback address 127.x.y.z (set in the environment or .env)" >&2
  exit 1
fi

# env_put <file> <regex of lines to drop>: replace those lines with stdin's lines. The
# file stays mode 600 and is never readable by anyone else, even briefly.
env_put() {
  (
    umask 077
    _tmp="$1.tmp.$$"
    if [ -f "$1" ]; then grep -vE "$2" "$1" > "${_tmp}" || true; else : > "${_tmp}"; fi
    cat >> "${_tmp}"
    mv "${_tmp}" "$1"
    chmod 600 "$1"
  )
}

# make_private <file>: mode 600, even if a container wrote it (it then belongs to
# root, and only a rewrite makes it ours).
make_private() {
  [ -f "$1" ] || return 0
  if [ -O "$1" ]; then
    chmod 600 "$1"
  else
    env_put "$1" '^$' < /dev/null
  fi
}

# add_name <hostname>: https-run maps every name in data/https/names to 127.0.0.1.
add_name() {
  mkdir -p "${HTTPS_DIR}"
  touch "${HTTPS_DIR}/names"
  grep -qxF "$1" "${HTTPS_DIR}/names" || echo "$1" >> "${HTTPS_DIR}/names"
}

# leaf_lacks: true when there is no leaf, or it lacks one of the rendered globe's names, an app's
# ending or HTTPS_EXTRA_NAMES (scripts/snowglobe certs --check).
leaf_lacks() {
  ! node "${ROOT_DIR}/scripts/snowglobe" certs --check
}

# render_apps: nginx's app routes, from data/https/apps (lines of "<name> <port>
# [<ending>]"), into data/https/nginx/: one upstream per app at host.docker.internal:<port>
# and, for an app that claimed a handle ending, a server for *.<ending>.<domain> (apps.conf),
# and one map line per name (apps.map). See https/nginx.conf.template. Also the network
# page's globe.json, which links each app (render_page).
render_apps() {
  mkdir -p "${HTTPS_DIR}/nginx"
  _apps="${HTTPS_DIR}/apps"
  _out="${HTTPS_DIR}/nginx"
  {
    echo "# Written by scripts/https-app.sh from data/https/apps; rerun it instead of editing."
    if [ -f "${_apps}" ]; then
      awk 'NF >= 2 { u = $1; gsub("-", "_", u); printf "upstream devnet_app_%s { server host.docker.internal:%s; }\n", u, $2 }' "${_apps}"
      # Host is passed through (the http block sets it), so the app answers
      # /.well-known/atproto-did for each handle. nginx takes the longer of two matching
      # wildcards, so these win over the alpha's *.<domain>.
      awk -v d="${DEVNET_DOMAIN}" 'NF >= 3 { u = $1; gsub("-", "_", u); printf "\n# Handles under %s.%s go to %s.\nserver {\n    listen 443 ssl;\n    server_name *.%s.%s;\n    location / {\n        proxy_pass http://devnet_app_%s;\n    }\n}\n", $3, d, $1, $3, d, u }' "${_apps}"
    fi
  } > "${_out}/apps.conf.tmp"
  {
    echo "# Written by scripts/https-app.sh from data/https/apps; rerun it instead of editing."
    if [ -f "${_apps}" ]; then
      awk 'NF >= 2 { u = $1; gsub("-", "_", u); printf "%s.devnet.internal devnet_app_%s;\n", $1, u }' "${_apps}"
    fi
  } > "${_out}/apps.map.tmp"
  mv "${_out}/apps.conf.tmp" "${_out}/apps.conf"
  mv "${_out}/apps.map.tmp" "${_out}/apps.map"
  render_page
}

# render_page: data/https/nginx/globe.json, what page/index.html shows at https://<domain>/.
# It names the devnet's own services, their health relays in page/devnet.conf, and the apps
# https-app.sh routed.
# App names are DNS labels, so they need no JSON escaping.
render_page() {
  _apps="${HTTPS_DIR}/apps"
  # The devnet's own pdsls comes first, then each routed app.
  _json="{\"name\": \"pdsls\", \"url\": \"https://pdsls.${DEVNET_DOMAIN}\"}"
  if [ -f "${_apps}" ]; then
    _json="${_json}$(awk 'NF >= 2 { printf ", {\"name\": \"%s\", \"url\": \"https://%s.devnet.internal\"}", $1, $1 }' "${_apps}")"
  fi
  cat > "${HTTPS_DIR}/nginx/globe.json.tmp" <<JSON
{
  "globe": "Local devnet",
  "domain": "${DEVNET_DOMAIN}",
  "apps": [${_json}],
  "about": "An atproto network on this machine: its own account servers, directory, relay and feed. Its accounts live in its own directory, not the public one, so Bluesky cannot find anything here, and apps run under scripts/https-run reach it at the real network's names.",
  "accountsNote": "Every account on the network, on each of its three account servers.",
  "feed": "/subscribe",
  "services": [
    ["Account server", "alpha", "pds", "The spaces alpha: people's accounts and their records"],
    ["Account server", "regular", "regular", "A current release, which serves no spaces"],
    ["Account server", "prod", "prod", "The build run in production"],
    ["Directory", "plc", "plc", "Maps each DID to its keys and account server; also plc.directory under https-run"],
    ["Relay", "relay", "relay", "Collects every account server's changes into one stream"],
    ["Feed", "jetstream", "jetstream", "The relay's stream as JSON, for apps (and this page)"],
    ["Handle lookup", "slingshot", "slingshot", "Resolves handles and records from this network only"],
    ["Sync", "", "sync", "TAP: backfills and syncs repos"],
    ["Mail", "", "mail", "Catches every message the account servers send"],
    ["Record browser", "pdsls", "pdsls", "PDSls, for this network's repos and records"]
  ],
  "accounts": [["/people", "person, alpha"], ["/people/regular", "person, regular"], ["/people/prod", "person, prod"]]
}
JSON
  mv "${HTTPS_DIR}/nginx/globe.json.tmp" "${HTTPS_DIR}/nginx/globe.json"
}
