# The upstream relay, rebuilt with allow-private-hosts.patch.
#
# Upstream's relay refuses loopback and private addresses in two places, with no
# setting to turn either off: the host check (an SSRF-safe transport) and the
# firehose dialer for wss:// hosts (an SSRF-safe dialer). Its admin requestCrawl
# accepts localhost:<port>, but the host check then fails, so a stock relay image can
# never crawl a devnet PDS; and a PDS at an https name behind a local TLS proxy
# resolves to a private address, which the dialer refuses. The patch makes both honor
# RELAY_ALLOW_PRIVATE_HOSTS=true (host_checker.go and slurper.go); nothing else changes.
#
# The binary is built from the same commit as the published image, which supplies
# everything else (admin UI, runtime layout).

ARG INDIGO_COMMIT=b2619d864df00a66455bd9f5f0c83c1ac13ad73d

FROM golang:1.26-alpine3.22 AS build
ARG INDIGO_COMMIT
RUN apk add --no-cache build-base git
WORKDIR /src
RUN git init -q \
 && git remote add origin https://github.com/bluesky-social/indigo.git \
 && git fetch -q --depth 1 origin "${INDIGO_COMMIT}" \
 && git checkout -q FETCH_HEAD
COPY allow-private-hosts.patch /tmp/
RUN git apply /tmp/allow-private-hosts.patch
ENV GOEXPERIMENT=loopvar
RUN go build -tags timetzdata -o /relay ./cmd/relay

FROM ghcr.io/bluesky-social/indigo:relay-${INDIGO_COMMIT}
COPY --from=build /relay /relay
