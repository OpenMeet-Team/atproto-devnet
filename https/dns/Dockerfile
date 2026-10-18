# The DNS a service in the compose network needs to check a handle: any name under
# DEVNET_DOMAIN answers nginx's address, and every other name goes to Docker's own DNS.
# On the machine the lab does this one name at a time (scripts/https-run); inside the
# network there is no such thing, and a handle's name is made when its account is.
FROM alpine:3.22
RUN apk add --no-cache dnsmasq
COPY dns.sh /dns.sh
ENTRYPOINT ["/bin/sh", "/dns.sh"]
