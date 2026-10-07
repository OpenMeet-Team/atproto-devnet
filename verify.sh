#!/usr/bin/env bash
# Frozen gate for the https devnet spike. Do not edit after the gate commit.
# Proves, against a SEPARATE compose project (devnet-https), that atmo signs in to an https PDS with
# zero atmo code: names mapped for one process only, one local CA, nginx on 443, no allowHttp.
# Every check asserts a positive artifact. Run from the worktree root: ./verify.sh
# SKIP_LIVE=1 runs checks 0-5 only (static).
set -uo pipefail
cd "$(dirname "$0")"

BASE=3c07e58
ATMO=/workspaces/scratch/wt-atmo-events-https-spike
ATMO_SHA=9255b29
PDS_NAME=pds.https.devnet.test
ATMO_NAME=atmo.devnet.internal
CA=data/https/ca.crt
LEAF=data/https/leaf.crt
DID_FILE=data/https/spike-account.did
PROJECT=devnet-https
PLAYWRIGHT_MODULE=${PLAYWRIGHT_MODULE:-/home/node/.local/share/mise/installs/npm-playwright/1.63.0/node_modules/.mise/playwright@1.63.0/node_modules/playwright/index.mjs}
export PLAYWRIGHT_MODULE
T=$(mktemp -d /tmp/https-spike-verify.XXXXXX)
pass=0; fail=0
ok() { echo "PASS $*"; pass=$((pass+1)); }
no() { echo "FAIL $*"; fail=$((fail+1)); }
finish() { echo "TALLY $pass passed, $fail failed"; [ "$fail" -eq 0 ]; exit $?; }

# 0. base
if git merge-base --is-ancestor $BASE HEAD; then ok "0 HEAD $(git rev-parse --short HEAD) contains $BASE"
else no "0 HEAD does not contain $BASE"; finish; fi

# 1. touch-set: only new spike files and the README; the shared stack's files untouched
changed=$(git diff --name-only $BASE -- . ':!verify.sh' | LC_ALL=C sort)
bad=$(echo "$changed" | grep -vE '^(docker-compose\.https\.yml|https/.+|scripts/https-[A-Za-z0-9._-]+|README\.md)$' | grep -v '^$' || true)
frozen=(docker-compose.yml docker-compose.spaces.yml docker-compose.multi-pds.yml docker-compose.relay.yml docker-compose.test.yml scripts/create-account.sh scripts/init.sh scripts/lexicon-authority.sh test relay)
ftot=$(git diff --numstat $BASE -- "${frozen[@]}" | awk '{s+=$1+$2} END {print s+0}')
n=$(echo "$changed" | grep -c . || true)
if [ -z "$bad" ] && [ "$ftot" -eq 0 ] && [ "$n" -ge 3 ] && echo "$changed" | grep -qx 'docker-compose.https.yml'; then
  ok "1 $n changed file(s), all spike files or README; shared stack's files 0 lines changed"
else no "1 changed outside the allowed set: [${bad//$'\n'/ }]; frozen lines $ftot (0); files $n (>=3); docker-compose.https.yml present: $(echo "$changed" | grep -cx 'docker-compose.https.yml')"; fi

# 2. hygiene: no key material tracked, no TLS bypass, no allowHttp, no attribution in commits
keys=$(git ls-files | grep -cE '\.(key|pem|crt|p12)$|^data/' || true)
bypass=$(git diff $BASE -- . ':!verify.sh' | grep '^+' | grep -ciE 'NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized *: *false|allowHttp|curl[^|]* (-k|--insecure)( |$)' || true)
attr=$(git log --format=%B $BASE..HEAD | grep -ciE 'co-authored-by|generated with|claude|\bom-[a-z0-9]{4,}' || true)
if [ "$keys" -eq 0 ] && [ "$bypass" -eq 0 ] && [ "$attr" -eq 0 ]; then ok "2 tracked key files 0, TLS-bypass/allowHttp lines 0, attribution/bead ids in commits 0"
else no "2 tracked key files $keys (0), TLS-bypass/allowHttp lines $bypass (0), attribution/bead ids $attr (0)"; fi

# 3. atmo has zero code changes
ah=$(git -C $ATMO rev-parse --short HEAD 2>/dev/null)
dirty=$(git -C $ATMO status --porcelain 2>/dev/null | wc -l)
ign=$(git -C $ATMO check-ignore -q apps/web/.dev.vars 2>/dev/null && [ -f $ATMO/apps/web/.dev.vars ] && echo yes || echo no)
if [ "$ah" = "$ATMO_SHA" ] && [ "$dirty" -eq 0 ] && [ "$ign" = yes ]; then ok "3 atmo at $ah with 0 changed or untracked files; its config is the git-ignored apps/web/.dev.vars"
else no "3 atmo HEAD $ah ($ATMO_SHA), changed/untracked $dirty (0), .dev.vars present and ignored: $ign"; fi

# 4. the shared devnet was not touched (container start times as recorded at spec time)
expected='/devnet-spaces-jetstream-1 2026-10-05T16:14:38.743036991Z
/devnet-spaces-maildev-1 2026-10-05T16:08:39.348764504Z
/devnet-spaces-pds-1 2026-10-05T16:14:21.241220654Z
/devnet-spaces-pds-prod-1 2026-10-05T16:14:38.289594138Z
/devnet-spaces-pds-regular-1 2026-10-05T16:14:38.40683215Z
/devnet-spaces-plc-1 2026-10-05T16:08:43.259658476Z
/devnet-spaces-postgres-1 2026-10-05T16:08:39.566475504Z
/devnet-spaces-relay-1 2026-10-05T16:14:37.98718671Z
/devnet-spaces-tap-1 2026-10-05T16:14:43.614557134Z'
actual=$(for c in $(docker compose -p devnet-spaces ps -q 2>/dev/null); do docker inspect -f '{{.Name}} {{.State.StartedAt}}' $c; done | LC_ALL=C sort)
if [ "$actual" = "$expected" ]; then ok "4 shared devnet-spaces: all 9 containers still started at their 10-05 times"
else no "4 shared devnet-spaces changed:"; diff <(echo "$expected") <(echo "$actual") | head; fi

# 5. one local CA, one leaf for every name
if [ -f $CA ] && [ -f $LEAF ] && openssl verify -CAfile $CA $LEAF >/dev/null 2>&1; then
  sans=$(openssl x509 -in $LEAF -noout -ext subjectAltName 2>/dev/null | tr ',' '\n' | sed 's/ *DNS://' | grep -v subjectAltName)
  miss=""; for nm in $PDS_NAME "*.https.devnet.test" plc.directory $ATMO_NAME; do echo "$sans" | grep -qxF "$nm" || miss="$miss $nm"; done
  if [ -z "$miss" ]; then ok "5 $LEAF verifies against $CA and names $PDS_NAME, *.https.devnet.test, plc.directory, $ATMO_NAME"
  else no "5 leaf is missing SANs:$miss"; fi
else no "5 $CA and $LEAF present and verifying: no"; fi

[ "${SKIP_LIVE:-}" = 1 ] && finish

# 6. the spike stack is up, on its own project, with nginx on 127.0.0.1:443
svc=$(docker compose -p $PROJECT ps --format '{{.Service}} {{.State}}' 2>/dev/null | LC_ALL=C sort)
up=$(echo "$svc" | grep -c ' running' || true)
has=$(for s in nginx pds plc; do echo "$svc" | grep -q "^$s running" && echo -n "$s "; done)
if [ "$has" = "nginx pds plc " ] && ss -ltn | grep -q '127.0.0.1:443 '; then ok "6 project $PROJECT: $up running (nginx, pds, plc among them); 127.0.0.1:443 listening"
else no "6 project $PROJECT services running: [$has] (nginx pds plc); 127.0.0.1:443 listening: $(ss -ltn | grep -c '127.0.0.1:443 ')"; fi

# 7. the PDS is an https origin: its resource and issuer are https://$PDS_NAME, verified against the CA
R="--resolve $PDS_NAME:443:127.0.0.1 --cacert $CA"
res=$(curl -sf $R https://$PDS_NAME/.well-known/oauth-protected-resource | jq -r .resource 2>/dev/null)
iss=$(curl -sf $R https://$PDS_NAME/.well-known/oauth-authorization-server | jq -r .issuer 2>/dev/null)
if [ "$res" = "https://$PDS_NAME" ] && [ "$iss" = "https://$PDS_NAME" ]; then ok "7 https://$PDS_NAME: resource and issuer are https://$PDS_NAME (TLS verified)"
else no "7 resource '$res', issuer '$iss' (want https://$PDS_NAME for both)"; fi

# 8. plc.directory, reached through nginx, is the spike's PLC: it holds the spike account on the https PDS
did=$(cat $DID_FILE 2>/dev/null)
ep=$(curl -sf --resolve plc.directory:443:127.0.0.1 --cacert $CA "https://plc.directory/$did" | jq -r '.service[] | select(.id=="#atproto_pds") | .serviceEndpoint' 2>/dev/null)
if [ -n "$did" ] && [ "$ep" = "https://$PDS_NAME" ]; then ok "8 https://plc.directory (mapped) holds $did with PDS https://$PDS_NAME"
else no "8 spike DID '$did' from $DID_FILE; its PDS via mapped plc.directory '$ep' (want https://$PDS_NAME)"; fi

# 9. the name mapping is scoped: inside scripts/https-run the names are local, outside plc.directory is not
in=$(for nm in plc.directory $PDS_NAME $ATMO_NAME; do scripts/https-run getent hosts $nm 2>/dev/null | awk '{print $1}' | head -1; done | grep -cx '127.0.0.1' || true)
out=$(getent hosts plc.directory | awk '{print $1}' | head -1)
if [ "$in" -eq 3 ] && [ -n "$out" ] && [ "$out" != 127.0.0.1 ]; then ok "9 inside https-run: plc.directory, $PDS_NAME, $ATMO_NAME -> 127.0.0.1; outside: plc.directory -> $out"
else no "9 inside https-run, names on 127.0.0.1: $in (3); outside plc.directory '$out' (want a non-loopback address)"; fi

# 10. atcute (atmo's own installed copy), allowHttp off: resolves through plc.directory, and the PDS
#     accepts a confidential client at a non-reserved name and refuses one under .test
scripts/https-run node scripts/https-probe.mjs >$T/probe.log 2>&1
l1=$(grep -cxE "RESOLVED did:plc:[a-z2-7]{24} on https://$PDS_NAME through plc\.directory, allowHttp off" $T/probe.log || true)
l2=$(grep -cE "^PAR ACCEPTED for confidential client https://$ATMO_NAME/" $T/probe.log || true)
l3=$(grep -cE '^REFUSED \.test client_id: ' $T/probe.log || true)
if [ "$l1" -eq 1 ] && [ "$l2" -eq 1 ] && [ "$l3" -eq 1 ]; then ok "10 probe: $(grep -E '^(RESOLVED|PAR|REFUSED)' $T/probe.log | cut -c1-90 | paste -sd'|')"
else no "10 probe lines: RESOLVED $l1, PAR ACCEPTED $l2, REFUSED .test $l3 (each 1)"; sed 's/^/    /' $T/probe.log | tail -8; fi

# 11. atmo with zero code changes signs in to the https PDS from a headless browser (loopback client, vite dev)
if ss -ltn | grep -q ':5454 '; then no "11 port 5454 is busy; free it first"
else
  ( cd $ATMO/apps/web && exec "$OLDPWD/scripts/https-run" pnpm dev ) >$T/dev.log 2>&1 &
  devpid=$!
  for _ in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:5454/ && break; sleep 1; done
  scripts/https-run node scripts/https-signin-walk.mjs >$T/walk.log 2>&1
  pkill -P $devpid 2>/dev/null; kill $devpid 2>/dev/null; sleep 2
  pkill -f "$ATMO/apps/web/node_modules/.bin/../vite" 2>/dev/null
  w1=$(grep -cxE "SIGNED IN $did by DID" $T/walk.log || true)
  w2=$(grep -cxE 'NAVIGATIONS [0-9]+, 0 off-site' $T/walk.log || true)
  pw=$(grep -ci password $T/walk.log || true)
  tls=$(grep -ciE 'UNABLE_TO_VERIFY|self[- ]signed certificate|CERT_' $T/dev.log || true)
  if [ -n "$did" ] && [ "$w1" -eq 1 ] && [ "$w2" -eq 1 ] && [ "$pw" -eq 0 ] && [ "$tls" -eq 0 ]; then
    ok "11 walk: SIGNED IN $did by DID; $(grep -E '^NAVIGATIONS' $T/walk.log); 'password' 0x; TLS errors in atmo's log 0x"
  else no "11 walk: SIGNED IN by DID $w1 (1), NAVIGATIONS line $w2 (1), 'password' $pw (0), TLS errors in dev log $tls (0)"; sed 's/^/    /' $T/walk.log | tail -8; fi
fi

finish
