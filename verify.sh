#!/usr/bin/env bash
# Frozen gate for stage 2 unit A: the https devnet as GENERIC tooling for the whole spaces stack. Do not
# edit after the gate commit. It proves, on a SCRATCH compose project (devnet-scratch) built from this
# worktree, that the six-file stack (the five spaces files plus docker-compose.https.yml) serves three
# PDSes at https names behind nginx on 127.0.0.1:443 with one local CA, that the relay crawls them over
# wss, and that the devnet's own tools (accounts, invite codes, lexicon publishing, app routes, https-run)
# work for any app. The devnet carries no app's names, accounts or lexicons. The shared devnet-spaces is
# never touched. Every check asserts a positive artifact. Run from the worktree root: ./verify.sh
# SKIP_LIVE=1 runs checks 0-6 only (static, plus the shared stack's start times).
set -uo pipefail
cd "$(dirname "$0")"

BASE=6f83528
P=devnet-scratch
export DEVNET_PROJECT=$P
CA=data/https/ca.crt
LEAF=data/https/leaf.crt
DENV=data/devnet.env
ACC=data/accounts.env
GACC=data/gate-accounts.env
CA_FP='A1:80:53:E3:DA:E4:FA:E5:FB:0E:B3:B5:B7:29:92:18:DF:EB:4A:9D:85:60:06:CF:2F:37:D6:2C:3D:11:45:8F'
PDS_NAMES="alpha.devnet.test regular.devnet.test prod.devnet.test"
# A directory from which node resolves @atcute/oauth-node-client and @atcute/identity-resolver. Only the
# library is used; the probe is the devnet's own.
ATCUTE_DIR=${ATCUTE_DIR:-/workspaces/scratch/wt-atmo-events-https-spike/apps/web}
export ATCUTE_DIR
T=$(mktemp -d /tmp/stage2-ua-verify.XXXXXX)
pass=0; fail=0
ok() { echo "PASS $*"; pass=$((pass+1)); }
no() { echo "FAIL $*"; fail=$((fail+1)); }
finish() { echo "TALLY $pass passed, $fail failed"; [ "$fail" -eq 0 ]; exit $?; }
ev() { sed -n "s/^$1=//p" "$2" 2>/dev/null | tail -1; }
# curl to a devnet name: the name goes to nginx on 127.0.0.1, TLS verified against the CA only.
dv() { local u="$1"; local h; h=$(echo "$u" | sed -E 's#^https://([^/]+).*#\1#'); shift
  curl -sf --resolve "$h:443:127.0.0.1" --cacert "$CA" "$@" "$u"; }
dvc() { local u="$1"; local h; h=$(echo "$u" | sed -E 's#^https://([^/]+).*#\1#'); shift
  curl -s -o /dev/null -w '%{http_code}' --resolve "$h:443:127.0.0.1" --cacert "$CA" "$@" "$u"; }

# 0. base
if git merge-base --is-ancestor $BASE HEAD; then ok "0 HEAD $(git rev-parse --short HEAD) contains $BASE"
else no "0 HEAD does not contain $BASE"; finish; fi

# 1. touch-set: only the overlay, nginx, the relay build, the https scripts and the README changed; the
#    five spaces compose files, the three old scripts and test/ are untouched; the new generic tools
#    exist and the app-specific sign-in walk is gone
changed=$(git diff --name-only $BASE -- . ':!verify.sh' | LC_ALL=C sort)
bad=$(echo "$changed" | grep -vE '^(docker-compose\.https\.yml|https/.+|relay/(Dockerfile|[A-Za-z0-9._-]+\.patch)|scripts/https-[A-Za-z0-9._-]+|README\.md)$' | grep -v '^$' || true)
frozen=(docker-compose.yml docker-compose.test.yml docker-compose.spaces.yml docker-compose.multi-pds.yml docker-compose.relay.yml scripts/init.sh scripts/create-account.sh scripts/lexicon-authority.sh test)
ftot=$(git diff --numstat $BASE -- "${frozen[@]}" | awk '{s+=$1+$2} END {print s+0}')
need=""; for f in docker-compose.https.yml https/nginx.conf scripts/https-up.sh scripts/https-ca.sh scripts/https-run scripts/https-probe.mjs README.md; do echo "$changed" | grep -qxF "$f" || need="$need $f"; done
new=""; for f in scripts/https-app.sh scripts/https-invite.sh scripts/https-lexicons.sh scripts/https-account.sh scripts/https-down.sh; do git ls-files --error-unmatch "$f" >/dev/null 2>&1 && [ -x "$f" ] || new="$new $f"; done
walk=$(git ls-files scripts/https-signin-walk.mjs | wc -l)
patched=$(echo "$changed" | grep -cE '^relay/[A-Za-z0-9._-]+\.patch$' || true)
if [ -z "$bad" ] && [ "$ftot" -eq 0 ] && [ -z "$need" ] && [ -z "$new" ] && [ "$walk" -eq 0 ] && [ "$patched" -ge 1 ]; then
  ok "1 $(echo "$changed" | grep -c .) changed file(s), all in the allowed set; frozen files 0 lines changed; required files changed; app, invite, lexicons, account, down tools tracked and executable; sign-in walk removed; relay patch changed"
else no "1 outside the allowed set: [${bad//$'\n'/ }]; frozen lines $ftot (0); not changed but must be:[$need]; tools missing or not executable:[$new]; sign-in walk still tracked: $walk (0); relay patches changed $patched (>=1)"; fi

# 2. hygiene: no key material or data/ tracked, no TLS bypass or allowHttp added, no attribution or bead
#    ids in commits, no top-level project name in the overlay, and NO APP-SPECIFIC NAME anywhere in the
#    devnet's https files (the devnet knows no app)
keys=$(git ls-files | grep -cE '\.(key|pem|crt|p12|srl)$|^data/' || true)
bypass=$(git diff $BASE -- . ':!verify.sh' | grep '^+' | grep -ciE 'NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized *: *false|allowHttp|curl[^|]* (-k|--insecure)( |$)|--ignore-certificate-errors( |$|")' || true)
attr=$(git log --format=%B $BASE..HEAD | grep -ciE 'co-authored-by|generated with|claude|\bom-[a-z0-9]{4,}' || true)
pname=$(grep -cE '^name:' docker-compose.https.yml 2>/dev/null || true)
appf=$(git ls-files docker-compose.https.yml 'https/*' 'scripts/https-*' 'relay/*' README.md)
apps=$(grep -ciE '\batmo\b|atmo_|rsvp\.atmo|authCreatePosts|groups-e2e|\bE2E_|WALK(OWNER|MEMBER|OUTSIDER|NOSPACES)|spikeowner' $appf 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
if [ "$keys" -eq 0 ] && [ "$bypass" -eq 0 ] && [ "$attr" -eq 0 ] && [ "$pname" -eq 0 ] && [ "$apps" -eq 0 ]; then ok "2 tracked key/data files 0, TLS-bypass/allowHttp lines 0, attribution/bead ids in commits 0, top-level name: 0, app-specific names in $(echo $appf | wc -w) devnet https files 0"
else no "2 tracked key/data files $keys (0), TLS-bypass/allowHttp lines $bypass (0), attribution/bead ids $attr (0), top-level name: $pname (0), app-specific names $apps (0): $(grep -liE '\batmo\b|atmo_|rsvp\.atmo|authCreatePosts|groups-e2e|\bE2E_|WALK(OWNER|MEMBER|OUTSIDER|NOSPACES)|spikeowner' $appf 2>/dev/null | paste -sd' ')"; fi

# 3. the CA Tom's host trusts is the one in use; the leaf names every stage 2 host plus any app name under
#    devnet.internal; the CA's name constraints still refuse anything outside the devnet
fp=$(openssl x509 -in $CA -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)
if [ "$fp" = "$CA_FP" ] && [ -f $LEAF ] && openssl verify -CAfile $CA $LEAF >/dev/null 2>&1; then
  sans=$(openssl x509 -in $LEAF -noout -ext subjectAltName 2>/dev/null | tr ',' '\n' | sed 's/ *DNS://' | grep -v subjectAltName)
  miss=""; for nm in "*.devnet.test" "*.regular.devnet.test" "*.prod.devnet.test" plc.directory "*.devnet.internal"; do echo "$sans" | grep -qxF "$nm" || miss="$miss $nm"; done
  ( cd $T && umask 077 && openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout gh.key -out gh.csr -subj /CN=github.com >/dev/null 2>&1 \
    && printf 'subjectAltName=DNS:github.com\nextendedKeyUsage=serverAuth\n' > gh.ext \
    && openssl x509 -req -sha256 -days 1 -in gh.csr -CA "$OLDPWD/$CA" -CAkey "$OLDPWD/data/https/ca.key" -CAserial gh.srl -CAcreateserial -extfile gh.ext -out gh.crt >/dev/null 2>&1 )
  ghv=$(openssl verify -CAfile $CA $T/gh.crt 2>&1 | grep -c 'permitted subtree violation' || true)
  rm -f $T/gh.key
  if [ -z "$miss" ] && [ "$ghv" -ge 1 ]; then ok "3 CA $CA_FP in use; $LEAF verifies and names *.devnet.test, *.regular.devnet.test, *.prod.devnet.test, plc.directory, *.devnet.internal; a github.com leaf from the CA fails: permitted subtree violation"
  else no "3 leaf missing SANs:[$miss]; github.com leaf refused by name constraints: $ghv (>=1)"; fi
else no "3 CA fingerprint '$fp' (want $CA_FP); $LEAF present and verifying: $( [ -f $LEAF ] && openssl verify -CAfile $CA $LEAF >/dev/null 2>&1 && echo yes || echo no)"; fi

# 4. the relay patch covers the host check AND the firehose dialer, each gated on RELAY_ALLOW_PRIVATE_HOSTS
pf=$(ls relay/*.patch 2>/dev/null)
hc=$(cat $pf 2>/dev/null | awk '/^diff --git/{f=($0 ~ /host_checker\.go/)} f && /^\+.*RELAY_ALLOW_PRIVATE_HOSTS/' | wc -l)
sl=$(cat $pf 2>/dev/null | awk '/^diff --git/{f=($0 ~ /slurper\.go/)} f && /^\+.*RELAY_ALLOW_PRIVATE_HOSTS/' | wc -l)
if [ "$hc" -ge 1 ] && [ "$sl" -ge 1 ]; then ok "4 relay patch: host_checker.go $hc and slurper.go $sl added line(s) naming RELAY_ALLOW_PRIVATE_HOSTS"
else no "4 relay patch lines naming RELAY_ALLOW_PRIVATE_HOSTS: host_checker.go $hc (>=1), slurper.go $sl (>=1)"; fi

# 5. the project guard, exercised against a fake docker (so a broken guard can never reach a real stack):
#    up and down require DEVNET_PROJECT, refuse devnet-spaces without DEVNET_RESET_OK=1, and pass -p plus
#    the six files with the overlay last
mkdir -p $T/bin
printf '#!/bin/sh\necho "$*" >> %s/docker.log\nexit 0\n' "$T" > $T/bin/docker; chmod +x $T/bin/docker
dlog() { cat $T/docker.log 2>/dev/null; }
: > $T/docker.log
env -u COMPOSE_PROJECT_NAME PATH="$T/bin:$PATH" DEVNET_PROJECT=$P scripts/https-down.sh >$T/g-ctl.out 2>&1
ctl=$(dlog | grep -cE "compose .*-p $P( |$)" || true)
files=$(dlog | grep -oE '\-f [^ ]+' | sed 's#.*/##; s#^-f ##' | paste -sd' ')
want="docker-compose.yml docker-compose.test.yml docker-compose.spaces.yml docker-compose.multi-pds.yml docker-compose.relay.yml docker-compose.https.yml"
if [ "$ctl" -ge 1 ]; then
  r=""
  for s in https-down.sh https-up.sh; do
    : > $T/docker.log; env -u DEVNET_PROJECT -u COMPOSE_PROJECT_NAME -u DEVNET_RESET_OK PATH="$T/bin:$PATH" scripts/$s >/dev/null 2>&1; e1=$?; c1=$(dlog | grep -c . || true)
    : > $T/docker.log; env -u COMPOSE_PROJECT_NAME -u DEVNET_RESET_OK PATH="$T/bin:$PATH" DEVNET_PROJECT=devnet-spaces scripts/$s >/dev/null 2>&1; e2=$?; c2=$(dlog | grep -c . || true)
    [ "$e1" -ne 0 ] && [ "$c1" -eq 0 ] && [ "$e2" -ne 0 ] && [ "$c2" -eq 0 ] || r="$r $s(unset exit $e1 docker $c1; devnet-spaces exit $e2 docker $c2)"
  done
  : > $T/docker.log; env -u COMPOSE_PROJECT_NAME PATH="$T/bin:$PATH" DEVNET_PROJECT=devnet-spaces DEVNET_RESET_OK=1 scripts/https-down.sh >/dev/null 2>&1
  ud=$(dlog | grep -cE 'compose .*-p devnet-spaces( |$)' || true)
  if [ -z "$r" ] && [ "$ud" -ge 1 ] && [ "$files" = "$want" ]; then ok "5 guard: up and down refuse an unset project and devnet-spaces (exit non-zero, docker called 0x); with DEVNET_RESET_OK=1 down names -p devnet-spaces; files in order: $files"
  else no "5 guard:$r; reset path calls -p devnet-spaces: $ud (>=1); files '$files' (want '$want')"; fi
else no "5 the fake docker saw no 'compose -p $P' from DEVNET_PROJECT=$P scripts/https-down.sh; refusal tests not run. Saw: $(dlog | head -2 | cut -c1-120)"; fi

# 6. the shared devnet was not touched (container start times as recorded at spec time, 2026-10-08)
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
if [ "$actual" = "$expected" ]; then ok "6 shared devnet-spaces: all 9 containers still started at their 10-05 times"
else no "6 shared devnet-spaces changed:"; diff <(echo "$expected") <(echo "$actual") | head; fi

[ "${SKIP_LIVE:-}" = 1 ] && finish

# 7. the scratch project runs from this worktree: ten services up, nginx on 127.0.0.1:443, every published
#    port on 127.0.0.1 and none of the dropped ones, the PLC's database on a named volume, and a relay
#    image of its own
svc=$(docker compose -p $P ps --format '{{.Service}} {{.State}}' 2>/dev/null | LC_ALL=C sort)
has=""; for s in jetstream maildev nginx pds pds-prod pds-regular plc postgres relay tap; do echo "$svc" | grep -q "^$s running" && has="$has $s"; done
pubs=$(docker compose -p $P ps --format json 2>/dev/null | jq -rs 'map(if type=="array" then .[] else . end) | .[] | .Publishers[]? | select(.PublishedPort>0) | "\(.URL):\(.PublishedPort)"' | LC_ALL=C sort -u)
nonlo=$(echo "$pubs" | grep -vcE '^127\.0\.0\.1:' || true)
dropped=$(echo "$pubs" | grep -cE ':(3010|3020|3030|2470|2480|5433)$' || true)
cfg=$(docker compose ls --format json 2>/dev/null | jq -r --arg p $P '.[] | select(.Name==$p) | .ConfigFiles')
pg=$(docker compose -p $P ps -q postgres 2>/dev/null)
vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}} {{.Name}}{{end}}{{end}}' $pg 2>/dev/null)
ri=$(docker inspect -f '{{.Config.Image}}' $(docker compose -p $P ps -q relay 2>/dev/null) 2>/dev/null)
si=$(docker inspect -f '{{.Config.Image}}' $(docker compose -p devnet-spaces ps -q relay 2>/dev/null) 2>/dev/null)
if [ "$has" = " jetstream maildev nginx pds pds-prod pds-regular plc postgres relay tap" ] && echo "$pubs" | grep -qx '127.0.0.1:443' \
   && [ "$nonlo" -eq 0 ] && [ "$dropped" -eq 0 ] && echo "$cfg" | grep -q "$(pwd)/docker-compose.https.yml" \
   && [ "$vol" = "volume ${P}_plc-db" ] && [ -n "$ri" ] && [ "$ri" != "$si" ]; then
  ok "7 project $P from this worktree: all 10 services running; published $(echo $pubs | tr ' ' ','), all 127.0.0.1, none dropped; postgres on volume ${P}_plc-db; relay image $ri (shared: $si)"
else no "7 running:[$has]; published [$(echo $pubs)] non-loopback $nonlo (0) dropped $dropped (0); config from this worktree: $(echo "$cfg" | grep -c "$(pwd)/docker-compose.https.yml"); postgres data '$vol' (want 'volume ${P}_plc-db'); relay image '$ri' vs shared '$si' (must differ)"; fi

# 8. three https PDS origins: resource and issuer are https://<name>; describeServer gives did:web:<name>,
#    the expected handle domain, and invites required on the alpha only
r8=""; d8=""
for n in $PDS_NAMES; do
  res=$(dv https://$n/.well-known/oauth-protected-resource | jq -r .resource 2>/dev/null)
  iss=$(dv https://$n/.well-known/oauth-authorization-server | jq -r .issuer 2>/dev/null)
  ds=$(dv https://$n/xrpc/com.atproto.server.describeServer 2>/dev/null)
  did=$(echo "$ds" | jq -r .did 2>/dev/null); dom=$(echo "$ds" | jq -r '.availableUserDomains | join(",")' 2>/dev/null); inv=$(echo "$ds" | jq -r .inviteCodeRequired 2>/dev/null)
  case $n in alpha.*) wd=.devnet.test; wi=true;; regular.*) wd=.regular.devnet.test; wi=false;; prod.*) wd=.prod.devnet.test; wi=false;; esac
  [ "$res" = "https://$n" ] && [ "$iss" = "https://$n" ] && [ "$did" = "did:web:$n" ] && [ "$dom" = "$wd" ] && [ "$inv" = "$wi" ] || r8="$r8 $n(resource '$res' issuer '$iss' did '$did' domains '$dom' invites '$inv')"
  d8="$d8 $n:$did:$dom:invites=$inv"
done
if [ -z "$r8" ]; then ok "8 resource and issuer https://<name> for all three;$d8"
else no "8$r8"; fi

# 9. the account tool, on all three PDSes: it prints only the DID, finds an existing account on a rerun,
#    keeps the login in the accounts file it is given (mode 600), and the handle resolves on its own PDS
r9=""; d9=""
for row in "gatealpha GATEALPHA alpha alpha.devnet.test .devnet.test" "gateregular GATEREGULAR regular regular.devnet.test .regular.devnet.test" "gateprod GATEPROD prod prod.devnet.test .prod.devnet.test"; do
  set -- $row
  o1=$(ACCOUNTS_FILE=$GACC scripts/https-account.sh $1 $2 $3 2>$T/acc-$1.err); e1=$?
  o2=$(ACCOUNTS_FILE=$GACC scripts/https-account.sh $1 $2 $3 2>>$T/acc-$1.err); e2=$?
  pw=$(ev ${2}_PASSWORD $GACC)
  leak=0; [ -n "$pw" ] && leak=$(cat $T/acc-$1.err <(echo "$o1$o2") | grep -cF "$pw" || true)
  got=$(dv "https://$4/xrpc/com.atproto.identity.resolveHandle?handle=$1$5" | jq -r .did 2>/dev/null)
  if [ $e1 -eq 0 ] && [ $e2 -eq 0 ] && echo "$o1" | grep -qxE 'did:plc:[a-z2-7]{24}' && [ "$o1" = "$o2" ] && [ -n "$pw" ] && [ "$leak" -eq 0 ] && [ "$got" = "$o1" ] && [ "$(ev ${2}_DID $GACC)" = "$o1" ]; then d9="$d9 $1$5=$o1"
  else r9="$r9 $1(exit $e1/$e2, did '$o1' rerun '$o2', resolves to '$got', password saved: $([ -n "$pw" ] && echo yes || echo no), password in output $leak)"; fi
done
mode=$(stat -c %a $GACC 2>/dev/null)
if [ -z "$r9" ] && [ "$mode" = 600 ]; then ok "9 account tool, created then found on rerun, handle resolving on its PDS:$d9; $GACC mode 600; secret in output 0x"
else no "9$r9; $GACC mode '$mode' (600)"; fi

# 10. every repo on the three PDSes has a PLC doc (through the mapped plc.directory) whose PDS is that
#     https origin; none is http; the alpha holds at least 4 repos, the others at least 1
tot=0; good=0; httpn=0; counts=""
for n in $PDS_NAMES; do
  dids=$(dv "https://$n/xrpc/com.atproto.sync.listRepos?limit=1000" | jq -r '.repos[].did' 2>/dev/null)
  c=$(echo "$dids" | grep -c . || true); counts="$counts ${n%%.*}=$c"
  for d in $dids; do
    tot=$((tot+1))
    ep=$(dv "https://plc.directory/$d" | jq -r '.service[] | select(.id=="#atproto_pds") | .serviceEndpoint' 2>/dev/null)
    [ "$ep" = "https://$n" ] && good=$((good+1))
    case "$ep" in http://*) httpn=$((httpn+1));; esac
  done
done
na=$(echo "$counts" | sed -nE 's/.*alpha=([0-9]+).*/\1/p'); nr=$(echo "$counts" | sed -nE 's/.*regular=([0-9]+).*/\1/p'); np=$(echo "$counts" | sed -nE 's/.*prod=([0-9]+).*/\1/p')
if [ "$tot" -gt 0 ] && [ "$good" -eq "$tot" ] && [ "$httpn" -eq 0 ] && [ "${na:-0}" -ge 4 ] && [ "${nr:-0}" -ge 1 ] && [ "${np:-0}" -ge 1 ]; then ok "10 repos$counts: $good of $tot PLC docs name their https PDS; http endpoints 0"
else no "10 repos$counts (alpha>=4, regular>=1, prod>=1): PLC docs naming their https PDS $good of $tot; http endpoints $httpn (0)"; fi

# 11. devnet.env names the devnet's own facts (no secret, no app); its lexicon authority is the one the
#     alpha was started with; accounts.env (mode 600) holds the authority's login, the invite code, alice
names="ALPHA_PDS_URL REGULAR_PDS_URL PROD_PDS_URL PLC_URL JETSTREAM_URL LEX_AUTHORITY_DID LEX_AUTHORITY_HANDLE"
unset_n=""; for v in $names; do [ -n "$(ev $v $DENV)" ] || unset_n="$unset_n $v"; done
secretish=$(grep -cE '^[A-Z0-9_]*(PASSWORD|SECRET|KEY|INVITE|TOKEN)[A-Z0-9_]*=' $DENV 2>/dev/null || true)
urls="$(ev ALPHA_PDS_URL $DENV) $(ev REGULAR_PDS_URL $DENV) $(ev PROD_PDS_URL $DENV) $(ev PLC_URL $DENV)"
js=$(ev JETSTREAM_URL $DENV)
pdsc=$(docker compose -p $P ps -q pds 2>/dev/null)
envad=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $pdsc 2>/dev/null | sed -n 's/^PDS_LEXICON_AUTHORITY_DID=//p')
sec=0; for v in LEX_AUTHORITY_PASSWORD DEVNET_INVITE_CODE ALICE_PASSWORD; do [ "$(grep -cE "^$v=." $ACC 2>/dev/null || true)" -ge 1 ] && sec=$((sec+1)); done
amode=$(stat -c %a $ACC 2>/dev/null)
if [ -z "$unset_n" ] && [ "$secretish" -eq 0 ] && [ "$urls" = "https://alpha.devnet.test https://regular.devnet.test https://prod.devnet.test https://plc.directory" ] \
   && echo "$js" | grep -qE '^ws://127\.0\.0\.1:[0-9]+$' && [ -n "$envad" ] && [ "$envad" = "$(ev LEX_AUTHORITY_DID $DENV)" ] && [ "$sec" -eq 3 ] && [ "$amode" = 600 ]; then
  ok "11 $DENV: all 7 names set, 0 secret-like names, https URLs, Jetstream $js; alpha started with authority $envad (= LEX_AUTHORITY_DID); $ACC mode 600 with 3 of 3 secrets non-empty"
else no "11 unset:[$unset_n]; secret-like $secretish (0); URLs '$urls'; Jetstream '$js'; alpha authority '$envad' vs devnet.env '$(ev LEX_AUTHORITY_DID $DENV)'; $ACC secrets $sec (3), mode '$amode' (600)"; fi

# 12. the lexicon tool publishes any folder of lexicons into the devnet's authority, idempotently, and they
#     read back over https (a record type and a permission set, both made up for this gate)
mkdir -p $T/lex/test/devnet/gate
cat > $T/lex/test/devnet/gate/note.json <<'EOF'
{"lexicon":1,"id":"test.devnet.gate.note","defs":{"main":{"type":"record","key":"tid","record":{"type":"object","required":["text"],"properties":{"text":{"type":"string","maxLength":100}}}}}}
EOF
cat > $T/lex/test/devnet/gate/access.json <<'EOF'
{"lexicon":1,"id":"test.devnet.gate.access","defs":{"main":{"type":"permission-set","title":"Gate notes","permissions":[{"type":"permission","resource":"repo","collection":["test.devnet.gate.note"]}]}}}
EOF
ad=$(ev LEX_AUTHORITY_DID $DENV)
lsr() { dv "https://alpha.devnet.test/xrpc/com.atproto.repo.listRecords?repo=$ad&collection=com.atproto.lexicon.schema&limit=100"; }
scripts/https-lexicons.sh $T/lex >$T/lex1.out 2>&1; l1=$?
n1=$(lsr | jq '.records | length' 2>/dev/null)
scripts/https-lexicons.sh $T/lex >$T/lex2.out 2>&1; l2=$?
recs=$(lsr)
n2=$(echo "$recs" | jq '.records | length' 2>/dev/null)
gn=$(echo "$recs" | jq -r '.records[] | select(.uri | endswith("/test.devnet.gate.note")) | .value.defs.main.type' 2>/dev/null)
ga=$(echo "$recs" | jq -r '.records[] | select(.uri | endswith("/test.devnet.gate.access")) | .value.defs.main.type' 2>/dev/null)
lpw=$(ev LEX_AUTHORITY_PASSWORD $ACC); lleak=0; [ -n "$lpw" ] && lleak=$(cat $T/lex1.out $T/lex2.out | grep -cF "$lpw" || true)
if [ $l1 -eq 0 ] && [ $l2 -eq 0 ] && [ "$gn" = record ] && [ "$ga" = permission-set ] && [ -n "$n1" ] && [ "$n1" = "$n2" ] && [ "$lleak" -eq 0 ]; then ok "12 lexicon tool: test.devnet.gate.note (record) and test.devnet.gate.access (permission-set) read back from $ad; rerun left $n2 records ($n1 before); secret in output 0x"
else no "12 lexicon tool exit $l1/$l2; note '$gn' (record), access '$ga' (permission-set); records $n1 then $n2 (equal); secret in output $lleak (0)"; sed 's/^/    /' $T/lex1.out | tail -4; fi

# 13. the invite tool mints a working alpha code into a named variable of a file, without printing it; the
#     alpha refuses a bogus code
scripts/https-invite.sh GATE_INVITE_CODE $GACC >$T/inv.out 2>&1; ie=$?
code=$(ev GATE_INVITE_CODE $GACC)
ileak=0; [ -n "$code" ] && ileak=$(grep -cF "$code" $T/inv.out || true)
h="gi$(date +%s).devnet.test"
mk() { jq -n --arg h "$h" --arg c "$1" --arg p "$(openssl rand -hex 12)" '{handle:$h,email:($h+"@devnet.test"),password:$p,inviteCode:$c}' \
  | curl -s --resolve alpha.devnet.test:443:127.0.0.1 --cacert $CA -X POST -H 'Content-Type: application/json' --data-binary @- https://alpha.devnet.test/xrpc/com.atproto.server.createAccount; }
bogus=$(mk "devnet-bogus-code" | jq -r '.error // "none"' 2>/dev/null)
real=$(mk "$code" | jq -r '.did // ("ERR " + (.error // "?"))' 2>/dev/null)
unset code
if [ $ie -eq 0 ] && [ "$ileak" -eq 0 ] && [ "$bogus" = InvalidInviteCode ] && echo "$real" | grep -qE '^did:plc:'; then ok "13 invite tool: GATE_INVITE_CODE written to $GACC, printed 0x; a bogus code gets $bogus; the minted code made $h -> $real"
else no "13 invite tool exit $ie, code printed $ileak (0); bogus code answer '$bogus' (InvalidInviteCode); minted code: '$real'"; fi

# 14. the relay crawls all three PDSes over wss, and a record written to the alpha arrives on this
#     project's Jetstream within 30 s (then is deleted)
hosts=$(docker exec $pdsc wget -qO- http://127.0.0.1:2470/xrpc/com.atproto.sync.listHosts 2>/dev/null | jq -r '.hosts[] | "\(.hostname) \(.status)"' 2>/dev/null | LC_ALL=C sort)
act=0; for n in $PDS_NAMES; do echo "$hosts" | grep -qx "$n active" && act=$((act+1)); done
AD=$(ev ALICE_DID $ACC)
# app.bsky.feed.post keys are TIDs and the PDS checks that in any mode, so mint one (microseconds << 10 | clock id)
RK=$(node -e 'const a="234567abcdefghijklmnopqrstuvwxyz";let v=(BigInt(Date.now())*1000n<<10n)|BigInt(Math.floor(Math.random()*1024));let s="";for(let i=0;i<13;i++){s=a[Number(v&31n)]+s;v>>=5n}console.log(s)')
cat > $T/js.mjs <<'EOF'
const [url, did, rkey] = process.argv.slice(2);
const t0 = Date.now();
const ws = new WebSocket(`${url.replace(/\/$/, '')}/subscribe?wantedCollections=app.bsky.feed.post&wantedDids=${did}`);
const stop = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);
ws.onopen = () => console.log('OPEN');
ws.onmessage = (m) => { const e = JSON.parse(m.data); if (e.commit?.rkey === rkey && e.commit?.operation === 'create') { console.log(`ARRIVED ${rkey} ${Date.now() - t0} ms`); clearTimeout(stop); process.exit(0); } };
ws.onerror = () => { console.log('WSERROR'); process.exit(1); };
EOF
node $T/js.mjs "$js" "$AD" "$RK" > $T/js.out 2>&1 & jpid=$!
for _ in $(seq 1 20); do grep -q OPEN $T/js.out && break; sleep 0.5; done
jwt=$(jq -n --arg i "$AD" --arg p "$(ev ALICE_PASSWORD $ACC)" '{identifier:$i,password:$p}' | dv https://alpha.devnet.test/xrpc/com.atproto.server.createSession -X POST -H 'Content-Type: application/json' --data-binary @- | jq -r .accessJwt 2>/dev/null)
jq -n --arg r "$AD" --arg k "$RK" --arg t "$(date -u +%FT%TZ)" '{repo:$r,collection:"app.bsky.feed.post",rkey:$k,record:{"$type":"app.bsky.feed.post",text:"devnet relay check",createdAt:$t}}' \
  | dv https://alpha.devnet.test/xrpc/com.atproto.repo.createRecord -X POST -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1
wait $jpid
arr=$(grep -E '^ARRIVED ' $T/js.out | head -1)
jq -n --arg r "$AD" --arg k "$RK" '{repo:$r,collection:"app.bsky.feed.post",rkey:$k}' \
  | dv https://alpha.devnet.test/xrpc/com.atproto.repo.deleteRecord -X POST -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1
unset jwt
if [ "$act" -eq 3 ] && [ -n "$arr" ]; then ok "14 relay listHosts: $(echo $hosts | tr ' ' ':'); Jetstream $js: $arr"
else no "14 relay hosts active $act (3): [$(echo $hosts)]; Jetstream '$js' for '$AD': $(tr '\n' ' ' < $T/js.out)"; fi

# 15. the app tool routes https://<name>.devnet.internal to a port on this machine for any app; an
#     unregistered name reaches nothing
ngx=$(docker compose -p $P ps -q nginx 2>/dev/null)
gw=$(docker exec $ngx getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' | head -1)
MK="gate-app-$(openssl rand -hex 6)"
cat > $T/app.mjs <<'EOF'
import { createServer } from 'node:http';
const [host, port, marker] = process.argv.slice(2);
let n = 0;
const s = createServer((req, res) => { n++; res.end(marker); });
s.listen(Number(port), host, () => console.log('LISTENING'));
setTimeout(() => { console.log(`HITS ${n}`); process.exit(0); }, 20000);
EOF
node $T/app.mjs "$gw" 5491 "$MK" > $T/app.out 2>&1 & apid=$!
for _ in $(seq 1 20); do grep -q LISTENING $T/app.out && break; sleep 0.5; done
scripts/https-app.sh gateapp 5491 >$T/app-reg.out 2>&1; ae=$?
sleep 2
body=$(dv https://gateapp.devnet.internal/ 2>/dev/null)
other=$(dvc https://nope.devnet.internal/)
wait $apid
hits=$(sed -n 's/^HITS //p' $T/app.out)
if [ -n "$gw" ] && [ $ae -eq 0 ] && [ "$body" = "$MK" ] && [ "$other" != 200 ] && [ "$hits" = 1 ]; then ok "15 app tool: https://gateapp.devnet.internal/ -> $gw:5491 answered the gate's marker; unregistered nope.devnet.internal got $other and reached nothing (server hits $hits)"
else no "15 host gateway '$gw'; app tool exit $ae; body matched: $([ "$body" = "$MK" ] && echo yes || echo no); unregistered name answer '$other' (not 200); server hits '$hits' (1)"; sed 's/^/    /' $T/app-reg.out | tail -3; fi

# 16. the name mapping is scoped: inside https-run the three PDS names, plc.directory, a registered app
#     name and every handle the account tool made are local; outside, plc.directory is not
nm16="$PDS_NAMES plc.directory gateapp.devnet.internal gatealpha.devnet.test gateregular.regular.devnet.test gateprod.prod.devnet.test"
in=$(scripts/https-run sh -c 'for n in "$@"; do getent hosts "$n" | awk "{print \$1}" | head -1; done' _ $nm16 2>/dev/null | grep -cx '127.0.0.1' || true)
out=$(getent hosts plc.directory | awk '{print $1}' | head -1)
if [ "$in" -eq 8 ] && [ -n "$out" ] && [ "$out" != 127.0.0.1 ]; then ok "16 inside https-run: $in of 8 names on 127.0.0.1; outside: plc.directory -> $out"
else no "16 inside https-run, names on 127.0.0.1: $in (8); outside plc.directory '$out' (want a non-loopback address)"; fi

# 17. a confidential OAuth client at an app name signs in against the https alpha with stock atcute,
#     allowHttp off: the probe resolves an account through plc.directory, the PDS accepts its PAR, and
#     refuses a client_id under .test
scripts/https-app.sh probe 5480 >/dev/null 2>&1
PROBE_DID=$(ev GATEALPHA_DID $GACC) PROBE_APP=probe PROBE_CLIENT_PORT=5480 scripts/https-run node scripts/https-probe.mjs >$T/probe.log 2>&1
l1=$(grep -cxE "RESOLVED $(ev GATEALPHA_DID $GACC) on https://alpha\.devnet\.test through plc\.directory, allowHttp off" $T/probe.log || true)
l2=$(grep -cE '^PAR ACCEPTED for confidential client https://probe\.devnet\.internal/' $T/probe.log || true)
l3=$(grep -cE '^REFUSED \.test client_id: ' $T/probe.log || true)
if [ "$l1" -eq 1 ] && [ "$l2" -eq 1 ] && [ "$l3" -eq 1 ]; then ok "17 probe: $(grep -E '^(RESOLVED|PAR|REFUSED)' $T/probe.log | cut -c1-90 | paste -sd'|')"
else no "17 probe lines: RESOLVED $l1, PAR ACCEPTED $l2, REFUSED .test $l3 (each 1)"; sed 's/^/    /' $T/probe.log | tail -8; fi

finish
