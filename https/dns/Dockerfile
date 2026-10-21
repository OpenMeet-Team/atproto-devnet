# The DNS a service in the compose network needs to check a handle: any name under
# SG_DOMAIN answers nginx's address. Docker's own DNS answers the service names first
# and asks this only for names it does not know; this refuses every name outside the domain,
# so nothing on the public internet resolves.
# On the machine the lab does this one name at a time (bin/snowglobe.mjs run); inside the
# network there is no such thing, and a handle's name is made when its account is.
FROM alpine:3.22
RUN apk add --no-cache dnsmasq
COPY dns.sh /dns.sh
ENTRYPOINT ["/bin/sh", "/dns.sh"]
