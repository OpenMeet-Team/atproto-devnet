#!/bin/sh
set -eu

# Seed the https devnet (spike): publish the permission sets an app's OAuth scope
# includes into the lexicon authority, then make the spike account.
#
# Usage: ./scripts/https-seed.sh   (scripts/https-up.sh runs it)
#
#   - data/https/lexicons/ holds the lexicon JSON files to publish, one per NSID
#     (rsvp.atmo.permissionSet and app.bsky.authCreatePosts, for atmo's sign-in).
#     They go in with the sandbox's seed-lexicons.mjs, run under scripts/https-run;
#     point SEED_LEXICONS at another copy of it if yours lives elsewhere.
#   - spikeowner.https.devnet.test: its login goes to data/https/accounts.env
#     (SPIKEOWNER_*), its DID alone to data/https/spike-account.did.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="$(cd "${SCRIPT_DIR}/.." && pwd)/data/https"
ACCOUNTS="${DATA}/accounts.env"
SEED_LEXICONS="${SEED_LEXICONS:-/workspaces/scratch/wt-atproto-permissioned-data-ewnj3/sandbox/opensocial/seed-lexicons.mjs}"

saved() { sed -n "s/^$1=//p" "${ACCOUNTS}" | tail -1; }

if [ -z "$(saved LEX_AUTHORITY_DID 2>/dev/null)" ]; then
  echo "No lexicon authority in ${ACCOUNTS}; run scripts/https-up.sh" >&2
  exit 1
fi

# Only the authority's own login goes to the seeder.
LEX_AUTHORITY_HANDLE="$(saved LEX_AUTHORITY_HANDLE)" \
LEX_AUTHORITY_DID="$(saved LEX_AUTHORITY_DID)" \
LEX_AUTHORITY_PASSWORD="$(saved LEX_AUTHORITY_PASSWORD)" \
LEX_AUTHORITY_PDS="$(saved LEX_AUTHORITY_PDS)" \
PROPOSAL_LEXICONS="${DATA}/lexicons" \
  "${SCRIPT_DIR}/https-run" node "${SEED_LEXICONS}"

DID=$("${SCRIPT_DIR}/https-account.sh" spikeowner SPIKEOWNER)
echo "${DID}" > "${DATA}/spike-account.did"
echo "Spike account ${DID} -> data/https/spike-account.did" >&2
