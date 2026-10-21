#!/bin/sh
# dnsmasq for the https devnet. Every name under $SG_DOMAIN answers nginx's address
# (A only; other record types get no answer, and nothing under the domain is asked of any
# other server). It is the container's `dns:` server, which Docker's embedded DNS asks for
# any name it does not know itself, so service names keep working and nothing else is
# answered here.
# nginx's address changes when nginx is recreated, so it is looked up again every few
# seconds and dnsmasq restarted when it moved.
# When dnsmasq dies it is started again here, and this script does not exit: slingshot runs
# in this container's network namespace, and restarting this container leaves slingshot
# with no network at all until slingshot is recreated too.
set -eu
: "${SG_DOMAIN:?}"
ip_of_nginx() { getent hosts nginx | awk 'NR == 1 { print $1 }'; }
start() {
  dnsmasq -k --no-resolv --no-hosts \
    --local="/${SG_DOMAIN}/" --address="/${SG_DOMAIN}/$1" &
  pid=$!
}
trap 'kill "${pid:-0}" 2>/dev/null; exit 0' TERM INT
# With no address, --address would answer NXDOMAIN for the whole domain, so wait for one.
ip=""
until [ -n "${ip}" ]; do
  ip=$(ip_of_nginx || true)
  [ -n "${ip}" ] || sleep 1
done
start "${ip}"
while sleep 5; do
  now=$(ip_of_nginx || true)
  if [ -n "${now}" ] && [ "${now}" != "${ip}" ]; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    ip="${now}"
    start "${ip}"
  elif ! kill -0 "${pid}" 2>/dev/null; then
    echo "dns.sh: dnsmasq exited; starting it again" >&2
    wait "${pid}" 2>/dev/null || true
    start "${ip}"
  fi
done
