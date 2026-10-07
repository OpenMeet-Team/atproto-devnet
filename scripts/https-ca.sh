#!/bin/sh
set -eu

# The https devnet's certificates: one local CA, made once, and one leaf that nginx
# serves for every name the spike maps.
#
# Usage: ./scripts/https-ca.sh
#
# Writes data/https/ca.crt, ca.key, leaf.crt and leaf.key (data/ is git-ignored).
# An existing CA is kept, so a browser or OS that trusts ca.crt keeps trusting the
# devnet; only the leaf is reissued. Delete data/https/ca.* to start over, and then
# trust the new ca.crt again everywhere the old one was trusted.
#
# The CA can only vouch for servers under devnet.test, devnet.internal and
# plc.directory (name constraints, serverAuth only, no IP addresses), so trusting it
# on a host cannot put any other site at risk, even if ca.key leaks from the pod.
# A name outside those makes the leaf fail its own check below; widening the list
# means a new CA, trusted again.
#
# Nothing here prints a key. Pass extra leaf names with HTTPS_EXTRA_NAMES
# (space-separated), for instance when a later stage adds a PDS.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${SCRIPT_DIR}/../data/https"
mkdir -p "${OUT}"
cd "${OUT}"

NAMES="pds.https.devnet.test *.https.devnet.test plc.directory atmo.devnet.internal ${HTTPS_EXTRA_NAMES:-}"

umask 077

if [ -f ca.crt ] && [ -f ca.key ]; then
  echo "Keeping the existing CA: $(openssl x509 -in ca.crt -noout -subject)" >&2
elif [ -f ca.crt ] || [ -f ca.key ]; then
  echo "Only one of data/https/ca.crt and ca.key exists. Restore the other, or delete" >&2
  echo "both to make a new CA (which must then be trusted again)." >&2
  exit 1
else
  openssl req -x509 -new -nodes -sha256 -days 730 \
    -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout ca.key -out ca.crt \
    -subj "/O=atproto-devnet/CN=atproto-devnet local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "extendedKeyUsage=serverAuth" \
    -addext "nameConstraints=critical,permitted;DNS:devnet.test,permitted;DNS:devnet.internal,permitted;DNS:plc.directory,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0"
  chmod 644 ca.crt
  echo "Made a new CA: $(openssl x509 -in ca.crt -noout -subject)" >&2
fi

SAN=""
set -f # the wildcard name is a name, not a glob
for name in ${NAMES}; do
  SAN="${SAN:+${SAN},}DNS:${name}"
done
set +f

cat > leaf.ext <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=${SAN}
EOF

openssl req -new -nodes -sha256 \
  -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout leaf.key -out leaf.csr \
  -subj "/O=atproto-devnet/CN=pds.https.devnet.test"
# 397 days: under the 398-day ceiling browsers apply to server certificates.
openssl x509 -req -sha256 -days 397 \
  -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -extfile leaf.ext -out leaf.crt
rm -f leaf.csr leaf.ext
chmod 644 leaf.crt
# nginx reads the leaf key as root inside its container.
chmod 600 leaf.key ca.key

openssl verify -CAfile ca.crt leaf.crt >&2
echo "Leaf names: $(openssl x509 -in leaf.crt -noout -ext subjectAltName | tail -n +2 | sed 's/^ *//')" >&2
echo "Leaf valid until $(openssl x509 -in leaf.crt -noout -enddate | cut -d= -f2)" >&2
