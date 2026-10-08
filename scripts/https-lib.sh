# Shared by the scripts/https-* tools; sourced, not run. Paths, the compose command for
# the https devnet, curl to a devnet name, and private env files. Nothing here prints a
# secret.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${ROOT_DIR}/data"
HTTPS_DIR="${DATA_DIR}/https"
CA="${HTTPS_DIR}/ca.crt"
# The devnet's own logins (the base init's alice, bob and invite code, the lexicon
# authority, and accounts made by https-account.sh).
DEVNET_ACCOUNTS="${DATA_DIR}/accounts.env"

# The three PDSes: short name, https name, handle domain.
pds_name() {
  case "$1" in
    alpha) echo alpha.devnet.test ;;
    regular) echo regular.devnet.test ;;
    prod) echo prod.devnet.test ;;
    *) return 1 ;;
  esac
}
pds_domain() {
  case "$1" in
    alpha) echo .devnet.test ;;
    regular) echo .regular.devnet.test ;;
    prod) echo .prod.devnet.test ;;
    *) return 1 ;;
  esac
}

# docker compose on DEVNET_PROJECT with the six files, the https overlay last.
dc() {
  docker compose -p "${DEVNET_PROJECT}" \
    -f "${ROOT_DIR}/docker-compose.yml" \
    -f "${ROOT_DIR}/docker-compose.test.yml" \
    -f "${ROOT_DIR}/docker-compose.spaces.yml" \
    -f "${ROOT_DIR}/docker-compose.multi-pds.yml" \
    -f "${ROOT_DIR}/docker-compose.relay.yml" \
    -f "${ROOT_DIR}/docker-compose.https.yml" \
    "$@"
}

# curl <https URL on a devnet name> [curl args...]: the name goes to nginx on
# 127.0.0.1, and TLS is verified against the devnet CA.
devnet_curl() {
  _url="$1"
  shift
  _host=$(printf '%s\n' "${_url}" | sed -E 's#^https://([^/:]+).*#\1#')
  curl -sS --resolve "${_host}:443:127.0.0.1" --cacert "${CA}" "$@" "${_url}"
}

# env_get <NAME> <file>: the last value of NAME in an env file, or nothing.
env_get() {
  [ -f "$2" ] || return 0
  sed -n "s/^$1=//p" "$2" | tail -1
}

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

# render_apps: nginx's app routes, from data/https/apps (lines of "<name> <port>"), into
# data/https/nginx/: one upstream per app at host.docker.internal:<port> (apps.conf) and
# one map line per name (apps.map). See https/nginx.conf.
render_apps() {
  mkdir -p "${HTTPS_DIR}/nginx"
  _apps="${HTTPS_DIR}/apps"
  _out="${HTTPS_DIR}/nginx"
  {
    echo "# Written by scripts/https-app.sh from data/https/apps; rerun it instead of editing."
    if [ -f "${_apps}" ]; then
      awk 'NF == 2 { u = $1; gsub("-", "_", u); printf "upstream devnet_app_%s { server host.docker.internal:%s; }\n", u, $2 }' "${_apps}"
    fi
  } > "${_out}/apps.conf.tmp"
  {
    echo "# Written by scripts/https-app.sh from data/https/apps; rerun it instead of editing."
    if [ -f "${_apps}" ]; then
      awk 'NF == 2 { u = $1; gsub("-", "_", u); printf "%s.devnet.internal devnet_app_%s;\n", $1, u }' "${_apps}"
    fi
  } > "${_out}/apps.map.tmp"
  mv "${_out}/apps.conf.tmp" "${_out}/apps.conf"
  mv "${_out}/apps.map.tmp" "${_out}/apps.map"
}
