# Slingshot (microcosm-rs), built from a pinned commit. Upstream publishes no image.
#
# Slingshot is the handle and record cache apps ask for a handle's DID and PDS
# (com.bad-example.identity.resolveMiniDoc). It takes its directory and its feed as
# settings (SLINGSHOT_PLC_DIRECTORY, SLINGSHOT_JETSTREAM), which is what lets it serve
# this network instead of the public one.
#
# The build follows microcosm-rs's own slingshot/Dockerfile, except that the source comes
# from the pinned commit rather than a build context.

ARG MICROCOSM_COMMIT=3137b07d5268812d2de0f3177664be92196994d8

FROM rust:1.96-bookworm AS build
ARG MICROCOSM_COMMIT
# aws-lc-sys builds a C library with cmake and bindgen (clang); reqwest's native-tls
# and the jetstream client need the OpenSSL headers.
RUN apt-get update && apt-get install -y --no-install-recommends \
        clang libclang-dev build-essential cmake libssl-dev pkg-config git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q \
 && git remote add origin https://tangled.org/jola.dev/microcosm-rs \
 && git fetch -q --depth 1 origin "${MICROCOSM_COMMIT}" \
 && git checkout -q FETCH_HEAD
RUN cargo build --release -p slingshot

FROM debian:12.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/slingshot /usr/local/bin/slingshot
# slingshot serves ./static/index.html relative to its working directory.
WORKDIR /app
COPY --from=build /src/slingshot/static ./static
RUN mkdir -p /data
VOLUME ["/data"]
ENTRYPOINT ["slingshot"]
