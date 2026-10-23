# PDSls (pds.ls), the record browser, for this network: built from a pinned upstream commit with
# network.patch, which lets a host page give it the network's addresses, and served by server.mjs,
# which gives it this network's and answers its lookups from inside the network. Upstream publishes
# no image.

ARG PDSLS_COMMIT=b9814fd14e6dd95945d04e71e3e12294b5f69530

FROM oven/bun:1.4.3 AS build
ARG PDSLS_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . && git remote add origin https://github.com/notjuliet/pdsls.git \
    && git fetch -q --depth 1 origin "${PDSLS_COMMIT}" && git checkout -q FETCH_HEAD
COPY network.patch /tmp/network.patch
RUN git apply /tmp/network.patch
RUN bun install --frozen-lockfile
# The OAuth client is the one server.mjs serves at the page's origin, so the build's own is unused.
RUN bun scripts/generate-metadata.js && bun node_modules/vite/bin/vite.js build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
