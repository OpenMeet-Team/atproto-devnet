#!/bin/sh
set -eu

# Publish lexicons into the https devnet's lexicon authority, the account every devnet
# PDS resolves NSIDs from (PDS_LEXICON_AUTHORITY_DID), as com.atproto.lexicon.schema
# records keyed by NSID. Prints each NSID on stdout, and nothing else there.
#
# Usage: ./scripts/https-lexicons.sh <dir>
#   <dir>  every *.json file under it, at any depth, whose "lexicon" is 1 and whose "id"
#          is an NSID. Other JSON files are skipped (named on stderr).
#
# Idempotent: a record that already holds the same document is left alone. The login
# is LEX_AUTHORITY_* from data/accounts.env (ACCOUNTS_FILE overrides), which
# scripts/https-up.sh writes. An app can instead publish with its own tool, signed in
# with the same login: it is an ordinary putRecord.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/https-lib.sh"

DIR="${1:-}"
if [ -z "${DIR}" ] || [ ! -d "${DIR}" ]; then
  echo "Usage: https-lexicons.sh <dir>" >&2
  exit 2
fi
ACCOUNTS="${ACCOUNTS_FILE:-${DEVNET_ACCOUNTS}}"
AUTH_DID="$(env_get LEX_AUTHORITY_DID "${ACCOUNTS}")"
AUTH_PDS="$(env_get LEX_AUTHORITY_PDS "${ACCOUNTS}")"
if [ -z "${AUTH_DID}" ] || [ -z "${AUTH_PDS}" ] || [ -z "$(env_get LEX_AUTHORITY_PASSWORD "${ACCOUNTS}")" ]; then
  echo "https-lexicons: no LEX_AUTHORITY_* login in ${ACCOUNTS}; run scripts/https-up.sh" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
umask 077

# Sign in; the access token goes to a header file, never to a command line or output.
SESSION=$(I="${AUTH_DID}" S="$(env_get LEX_AUTHORITY_PASSWORD "${ACCOUNTS}")" jq -n '{identifier: env.I, password: env.S}' \
  | devnet_curl "${AUTH_PDS}/xrpc/com.atproto.server.createSession" -X POST -H "Content-Type: application/json" --data-binary @-)
JWT=$(echo "${SESSION}" | jq -r '.accessJwt // empty' 2>/dev/null || true)
if [ -z "${JWT}" ]; then
  echo "https-lexicons: the authority cannot sign in: $(echo "${SESSION}" | jq -r '.error // "no JSON answer"' 2>/dev/null)" >&2
  exit 1
fi
printf 'Authorization: Bearer %s\n' "${JWT}" > "${TMP}/auth"
unset JWT SESSION

find "${DIR}" -type f -name '*.json' | LC_ALL=C sort > "${TMP}/files"
published=0; unchanged=0; skipped=0
while IFS= read -r f; do
  nsid=$(jq -r 'if (.lexicon == 1 and (.id | type) == "string") then .id else empty end' "${f}" 2>/dev/null || true)
  if [ -z "${nsid}" ] || ! echo "${nsid}" | grep -qxE '[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?){2,}'; then
    echo "skipped (not a lexicon document): ${f}" >&2
    skipped=$((skipped + 1))
    continue
  fi
  jq -cS '. + {"$type": "com.atproto.lexicon.schema"}' "${f}" > "${TMP}/record"
  devnet_curl "${AUTH_PDS}/xrpc/com.atproto.repo.getRecord?repo=${AUTH_DID}&collection=com.atproto.lexicon.schema&rkey=${nsid}" \
    | jq -cS '.value // empty' > "${TMP}/current" 2>/dev/null || true
  if cmp -s "${TMP}/record" "${TMP}/current"; then
    unchanged=$((unchanged + 1))
  else
    out=$(jq -n --arg repo "${AUTH_DID}" --arg rkey "${nsid}" --slurpfile rec "${TMP}/record" \
        '{repo: $repo, collection: "com.atproto.lexicon.schema", rkey: $rkey, record: $rec[0]}' \
      | devnet_curl "${AUTH_PDS}/xrpc/com.atproto.repo.putRecord" -X POST -H @"${TMP}/auth" \
          -H "Content-Type: application/json" --data-binary @-)
    if [ -z "$(echo "${out}" | jq -r '.uri // empty' 2>/dev/null || true)" ]; then
      echo "https-lexicons: putRecord ${nsid} failed: $(echo "${out}" | jq -r '((.error // "") + " " + (.message // ""))' 2>/dev/null || echo "no JSON answer")" >&2
      exit 1
    fi
    published=$((published + 1))
  fi
  echo "${nsid}"
done < "${TMP}/files"

echo "Authority ${AUTH_DID}: ${published} published, ${unchanged} unchanged, ${skipped} skipped" >&2
