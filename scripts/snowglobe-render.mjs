// The https globe a checked snowglobe.yml describes, as files: a compose file with every
// service, nginx's servers for the globe's names, the leaf certificate's names and the
// facts the https-* scripts read. Pure: a globe (from snowglobe-config.mjs) and the base
// compose files in, file texts out. scripts/snowglobe render writes them.
//
// Each PDS is a plain service on the compose network, pds-<name>, reached by that name.
// Nothing shares another's network namespace except Slingshot, which runs in
// slingshot-dns's for its DNS. Inside the network nginx also answers to every PDS's https
// name, so the PDSes, the relay and TAP reach each other over TLS as on the real network.
//
// The services the plain http stacks share (PLC, Postgres, maildev, Jetstream, TAP, init,
// the relay) start from their definitions in docker-compose.yml, docker-compose.test.yml and
// docker-compose.relay.yml, so a change there reaches the globe too. What only the https
// globe runs is defined here.

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { RESERVED } from './snowglobe-config.mjs';

// Every PDS listens on this port inside its own container.
export const PDS_PORT = 3000;

const CA = './data/https/ca.crt:/https/ca.crt:ro';
const APP_NAMES = './https/app-names.cjs:/https/app-names.cjs:ro';
// Go reads every file in /etc/ssl/certs on top of its bundle, so the public roots stay.
const GO_CA = './data/https/ca.crt:/etc/ssl/certs/atproto-devnet-ca.pem:ro';
const NETWORK = 'atproto-devnet';
const healthy = { condition: 'service_healthy' };

/** The base compose files' services, which the globe's shared services start from. */
export function loadBase(root) {
  // logLevel: the http overlays' !reset and !override tags are on services not read here.
  const services = (f) => parse(readFileSync(join(root, f), 'utf8'), { logLevel: 'error' }).services;
  return {
    base: services('docker-compose.yml'),
    test: services('docker-compose.test.yml'),
    relay: services('docker-compose.relay.yml'),
  };
}

/**
 * Render a checked globe. globeDir is where the files will be, relative to the compose
 * project directory (the repo root), because the compose file mounts nginx's part of it.
 * Returns { '<path under globeDir>': text }.
 */
export function renderGlobe(globe, base, { globeDir = 'data/globe', source = 'snowglobe.yml' } = {}) {
  const D = globe.domain;
  const svc = (p) => `pds-${p.name}`;
  const host = (p) => `${p.name}.${D}`;
  const handleDomain = (p) => (p.bare_handles ? `.${D}` : `.${p.name}.${D}`);
  const handleWildcard = (p) => `*${handleDomain(p)}`;
  // init seeds alice, bob and the invite code on the PDS with bare handles, else the first.
  const seed = globe.pds.find((p) => p.bare_handles) ?? globe.pds[0];
  const on = globe.services;
  // Where Jetstream and TAP read: the relay, or with one PDS that PDS's own firehose.
  const feed = on.relay ? 'http://relay:2470' : `http://${svc(globe.pds[0])}:${PDS_PORT}`;
  const copy = (o) => structuredClone(o);

  const services = {};

  services.postgres = {
    ...copy(base.test.postgres),
    // The PLC's database, named, so a `down` without -v keeps every DID.
    volumes: ['plc-db:/var/lib/postgresql/data'],
  };
  delete services.postgres.ports;

  services.maildev = {
    ...copy(base.test.maildev),
    ports: [
      '127.0.0.1:${DEVNET_MAILDEV_WEB_PORT:-1081}:1080',
      '127.0.0.1:${DEVNET_MAILDEV_SMTP_PORT:-1026}:1025',
    ],
  };

  services.plc = {
    ...copy(base.base.plc),
    depends_on: { postgres: healthy },
    ports: ['127.0.0.1:${DEVNET_PLC_PORT:-2582}:2582'],
  };

  const pdsBase = base.base.pds;
  for (const p of globe.pds) {
    services[svc(p)] = {
      image: p.image,
      // Release images run as root; monorepo images run as `node`, which cannot open the
      // root-owned data volume.
      user: 'root',
      restart: 'unless-stopped',
      depends_on: { plc: healthy },
      environment: {
        // The AppView, report service, secrets and logging as docker-compose.yml has them.
        ...copy(pdsBase.environment),
        PDS_PORT: String(PDS_PORT),
        PDS_HOSTNAME: host(p),
        PDS_SERVICE_DID: `did:web:${host(p)}`,
        PDS_SERVICE_HANDLE_DOMAINS: handleDomain(p),
        PDS_HANDLE_DOMAINS: handleDomain(p),
        PDS_INVITE_REQUIRED: p.invites === 'required' ? 'true' : 'false',
        PDS_EMAIL_SMTP_URL: 'smtp://maildev:1025',
        PDS_EMAIL_FROM_ADDRESS: `noreply@${D}`,
        PDS_LEXICON_AUTHORITY_DID: '${DEVNET_LEXICON_AUTHORITY_DID:-}',
        // The public URL is https, so each PDS runs as it would on the real network.
        PDS_DEV_MODE: 'false',
        // Every address a PDS fetches from here (nginx, the PLC, this machine) is an RFC
        // 1918 one, which the SSRF-protected fetch would refuse.
        PDS_DISABLE_SSRF_PROTECTION: 'true',
        NODE_EXTRA_CA_CERTS: '/https/ca.crt',
        // <name>.devnet.internal resolves to nginx inside each PDS (https/app-names.cjs).
        NODE_OPTIONS: '--require /https/app-names.cjs',
      },
      volumes: [`${svc(p)}-data:/pds/data`, CA, APP_NAMES],
      networks: [NETWORK],
      healthcheck: { ...copy(pdsBase.healthcheck), test: ['CMD', 'wget', '-q', '--spider', `http://127.0.0.1:${PDS_PORT}/xrpc/_health`] },
    };
  }

  if (on.relay) {
    const relay = copy(base.relay.relay);
    delete relay.network_mode;
    // Every host is a wss:// one.
    delete relay.environment.RELAY_ALLOW_INSECURE_HOSTS;
    services.relay = {
      ...relay,
      // Its own tag, so an image built from an older relay/ patch is never reused.
      image: 'atproto-devnet-relay:https-${DEVNET_RELAY_INDIGO_COMMIT:-b2619d864df00a66455bd9f5f0c83c1ac13ad73d}',
      depends_on: { nginx: healthy },
      volumes: [...relay.volumes, GO_CA],
      networks: [NETWORK],
    };
    // The relay adds a host only through its admin API, so a PDS cannot register itself with
    // requestCrawl. Bare names are https/wss hosts to the relay.
    services['relay-init'] = {
      image: 'alpine:3.20',
      depends_on: { relay: healthy, nginx: healthy, ...Object.fromEntries(globe.pds.map((p) => [svc(p), healthy])) },
      environment: {
        RELAY_ADMIN_PASSWORD: base.relay.relay.environment.RELAY_ADMIN_PASSWORD,
        RELAY_HOSTS: globe.pds.map(host).join(' '),
      },
      entrypoint: '/bin/sh',
      command: [
        '-c',
        [
          'set -eu',
          'apk add --no-cache curl >/dev/null 2>&1',
          'for host in $$RELAY_HOSTS; do',
          '  echo "[relay-init] crawl $$host"',
          '  curl -sf -u "admin:$$RELAY_ADMIN_PASSWORD" -H "Content-Type: application/json" \\',
          '    -d "{\\"hostname\\": \\"$$host\\"}" http://relay:2470/admin/pds/requestCrawl',
          '  echo',
          'done',
          '',
        ].join('\n'),
      ],
      networks: [NETWORK],
      restart: 'no',
    };
  }

  if (on.jetstream) {
    services.jetstream = {
      ...copy(base.base.jetstream),
      depends_on: on.relay ? { relay: healthy } : { [svc(globe.pds[0])]: healthy },
      environment: {
        ...copy(base.base.jetstream.environment),
        JETSTREAM_WS_URL: `${feed.replace(/^http/, 'ws')}/xrpc/com.atproto.sync.subscribeRepos`,
      },
      ports: [
        '127.0.0.1:${DEVNET_JETSTREAM_PORT:-6008}:6008',
        '127.0.0.1:${DEVNET_JETSTREAM_METRICS_PORT:-6009}:6009',
      ],
    };
  }

  if (on.tap) {
    // Resync fetches repos through an SSRF-safe transport, which refuses nginx's address, so
    // TAP follows the stream but cannot resync a repo here.
    services.tap = {
      ...copy(base.base.tap),
      depends_on: on.relay ? { relay: healthy } : { [svc(globe.pds[0])]: healthy },
      environment: { ...copy(base.base.tap.environment), TAP_RELAY_URL: feed },
      volumes: [...base.base.tap.volumes, GO_CA],
    };
    delete services.tap.ports;
  }

  // init seeds alice and bob (data/accounts.env) on the seed PDS, under its handle domain.
  // init.sh names http://pds:3000, so it is pointed at the seed PDS's service.
  services.init = {
    ...copy(base.base.init),
    depends_on: { [svc(seed)]: healthy, plc: healthy },
    environment: {
      ...copy(base.base.init.environment),
      PDS_HOSTNAME: host(seed),
      HANDLE_DOMAIN: handleDomain(seed),
      DEVNET_DOMAIN: D,
    },
    entrypoint: '/bin/sh',
    command: ['-c', `sed "s#http://pds:3000#http://${svc(seed)}:${PDS_PORT}#" /scripts/init.sh > /tmp/init.sh && sh /tmp/init.sh`],
  };

  services.nginx = {
    image: 'nginx:1.30-alpine',
    restart: 'unless-stopped',
    depends_on: { plc: healthy, ...Object.fromEntries(globe.pds.map((p) => [svc(p), healthy])) },
    ports: ['${DEVNET_BIND:-127.0.0.1}:443:443'],
    extra_hosts: [
      // This machine, where an app registered with scripts/https-app.sh listens.
      'host.docker.internal:host-gateway',
    ],
    environment: {
      // The image fills ${DEVNET_DOMAIN} into the template at start, and only names starting
      // DEVNET_, so nginx's own $host and the like are left alone.
      DEVNET_DOMAIN: D,
      NGINX_ENVSUBST_FILTER: '^DEVNET_',
    },
    volumes: [
      './https/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro',
      './data/https/leaf.crt:/etc/nginx/https/leaf.crt:ro',
      './data/https/leaf.key:/etc/nginx/https/leaf.key:ro',
      // The app routes and the page's globe.json, which scripts/https-app.sh writes (a
      // directory, so a rewrite shows up).
      './data/https/nginx:/etc/nginx/devnet:ro',
      // The globe's own servers and the page's relays to its PDSes, rendered here.
      `${isAbsolute(globeDir) ? globeDir : `./${globeDir}`}/nginx:/etc/nginx/globe:ro`,
      // The network's page, the one a hosted globe serves, and its relays.
      './page/index.html:/srv/page/index.html:ro',
      './page/devnet.conf:/etc/nginx/page/devnet.conf:ro',
    ],
    networks: {
      // Inside the network every PDS's https name is nginx, so the PDSes, the relay and TAP
      // reach each PDS over TLS at its public URL.
      [NETWORK]: { aliases: globe.pds.map(host) },
    },
    healthcheck: { test: ['CMD', 'nginx', '-t', '-q'], interval: '5s', timeout: '3s', retries: 10 },
  };

  if (on.slingshot) {
    // Slingshot (microcosm-rs) answers com.bad-example.identity.resolveMiniDoc, a handle's DID
    // and PDS, from this globe's PLC and Jetstream. It reaches the handles' names over TLS,
    // which needs the CA as its only root and a DNS that answers any name under the domain:
    // slingshot-dns, whose network namespace it runs in, so nginx reaches it as slingshot-dns:8080.
    services['slingshot-dns'] = {
      build: './https/dns',
      image: 'atproto-devnet-dns:https-1',
      restart: 'unless-stopped',
      environment: { DEVNET_DOMAIN: D },
      dns: ['127.0.0.1'],
      depends_on: { nginx: healthy },
      networks: [NETWORK],
    };
    services.slingshot = {
      // DEVNET_SLINGSHOT_COMMIT is a full microcosm-rs commit: it picks what is built and names
      // the image, so the tag is always the source.
      build: {
        context: './slingshot',
        args: { MICROCOSM_COMMIT: '${DEVNET_SLINGSHOT_COMMIT:-3137b07d5268812d2de0f3177664be92196994d8}' },
      },
      image: 'atproto-devnet-slingshot:${DEVNET_SLINGSHOT_COMMIT:-3137b07d5268812d2de0f3177664be92196994d8}',
      restart: 'unless-stopped',
      network_mode: 'service:slingshot-dns',
      depends_on: { 'slingshot-dns': { condition: 'service_started' }, plc: healthy, jetstream: healthy },
      environment: {
        SLINGSHOT_PLC_DIRECTORY: 'http://plc:2582',
        SLINGSHOT_JETSTREAM: 'ws://jetstream:6008/subscribe',
        SLINGSHOT_CACHE_DIR: '/data',
        SLINGSHOT_BIND: '0.0.0.0:8080',
        // The CA is the only root; the names it reaches are all the globe's.
        SSL_CERT_FILE: '/https/ca.crt',
      },
      volumes: [CA, 'slingshot-data:/data'],
      healthcheck: { test: ['CMD-SHELL', "bash -c 'echo > /dev/tcp/127.0.0.1/8080'"], interval: '5s', timeout: '3s', retries: 10 },
    };
  }

  // A browser on another computer reaches the globe through this, with no launch flags and no
  // hosts file: http://127.0.0.1:<DEVNET_PROXY_PORT>/proxy.pac sends the globe's names here (HTTP
  // CONNECT, or SOCKS5), and the proxy sends each to nginx and refuses everything else
  // (https/proxy/server.mjs). Forward the port to the browser's machine.
  services.proxy = {
    build: './https/proxy',
    image: 'atproto-devnet-proxy:https-1',
    restart: 'unless-stopped',
    depends_on: { nginx: healthy },
    environment: { PROXY_DOMAIN: D, PROXY_UPSTREAM: 'nginx:443' },
    ports: ['127.0.0.1:${DEVNET_PROXY_PORT:-1080}:1080'],
    networks: [NETWORK],
    healthcheck: { test: ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:1080/_health'], interval: '5s', timeout: '3s', retries: 10 },
  };

  if (on.pdsls) {
    // PDSls, the record browser apps link to, at pdsls.<domain>: built from a pinned commit with
    // pdsls/network.patch and given this globe's addresses by pdsls/server.mjs, which also answers
    // its handle and did:web lookups through nginx, for names under the domain only.
    services.pdsls = {
      build: './pdsls',
      image: 'atproto-devnet-pdsls:https-1',
      restart: 'unless-stopped',
      depends_on: { nginx: healthy },
      environment: {
        PDSLS_PUBLIC_URL: `https://pdsls.${D}`,
        PDSLS_DOMAIN: D,
        PDSLS_PLC_URL: `https://plc.${D}`,
        PDSLS_JETSTREAM_URL: on.jetstream ? `wss://jetstream.${D}/subscribe` : '',
        PDSLS_FIREHOSE_URL: on.relay ? `wss://relay.${D}` : `wss://${host(globe.pds[0])}`,
        PDSLS_LEXICON_AUTHORITY: '${DEVNET_LEXICON_AUTHORITY_DID:-}',
        PDSLS_UPSTREAM: 'nginx:443',
        NODE_EXTRA_CA_CERTS: '/https/ca.crt',
      },
      volumes: [CA],
      networks: [NETWORK],
      healthcheck: { test: ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/_health'], interval: '5s', timeout: '3s', retries: 10 },
    };
  }

  const volumes = { 'plc-db': null };
  for (const p of globe.pds) volumes[`${svc(p)}-data`] = null;
  if (on.relay) volumes['relay-data'] = null;
  if (on.jetstream) volumes['jetstream-data'] = null;
  if (on.tap) volumes['tap-data'] = null;
  if (on.slingshot) volumes['slingshot-data'] = null;

  const header = (c) =>
    `${c} Written by scripts/snowglobe render from ${source}; render again instead of editing.\n`;

  const compose =
    header('#') +
    `# The https globe "${globe.globe}" at ${D}: ${globe.pds.map((p) => p.name).join(', ')}.\n` +
    '# Run it with scripts/https-up.sh, which renders this file first.\n\n' +
    // YAML 1.1 quoting, so a value such as restart's "no" stays a string to compose.
    stringify({ services, volumes, networks: { [NETWORK]: null } }, { lineWidth: 0, nullStr: '', aliasDuplicateObjects: false, version: '1.1' });

  // nginx: one server per PDS for its name and its handles, then the globe's services. Of two
  // matching wildcards nginx takes the longer, so *.<pds>.<domain> wins over *.<domain>. A
  // variable upstream is looked up on each request, so a recreated container is found.
  const server = (names, upstream) =>
    `server {\n    listen 443 ssl;\n    server_name ${names};\n    location / {\n        set $upstream ${upstream};\n        proxy_pass $upstream;\n    }\n}\n`;
  const servers = [
    ...globe.pds.map((p) => `# ${p.name}: the PDS and every handle under ${handleDomain(p).slice(1)}.\n` + server(`${host(p)} ${handleWildcard(p)}`, `http://${svc(p)}:${PDS_PORT}`)),
    // The relay and the feed at https names, as a hosted globe has them, so an app's browser
    // code, which cannot use plain http or the host's ports, reaches them too.
    on.relay && server(`relay.${D}`, 'http://relay:2470'),
    on.jetstream && server(`jetstream.${D}`, 'http://jetstream:6008'),
    on.slingshot && server(`slingshot.${D}`, 'http://slingshot-dns:8080'),
    on.pdsls && server(`pdsls.${D}`, 'http://pdsls:8080'),
  ].filter(Boolean);
  const globeConf = header('#') + '\n' + servers.join('\n');

  // The page's relays to each PDS (page/devnet.conf includes this). /health/pds and /people/
  // are the seed PDS's, as the page's globe.json names them.
  const u = (p) => `$pds_${p.name.replace(/-/g, '_')}`;
  const pageInc =
    header('#') +
    '\n' +
    globe.pds.map((p) => `set ${u(p)} http://${svc(p)}:${PDS_PORT};\n`).join('') +
    '\n' +
    [
      `location = /health/pds { proxy_pass ${u(seed)}/xrpc/_health; }`,
      `location = /people/listRepos { proxy_pass ${u(seed)}/xrpc/com.atproto.sync.listRepos$is_args$args; }`,
      `location = /people/describeRepo { proxy_pass ${u(seed)}/xrpc/com.atproto.repo.describeRepo$is_args$args; }`,
      ...globe.pds.flatMap((p) => [
        `location = /health/${p.name} { proxy_pass ${u(p)}/xrpc/_health; }`,
        `location = /people/${p.name}/listRepos { proxy_pass ${u(p)}/xrpc/com.atproto.sync.listRepos$is_args$args; }`,
        `location = /people/${p.name}/describeRepo { proxy_pass ${u(p)}/xrpc/com.atproto.repo.describeRepo$is_args$args; }`,
      ]),
    ].join('\n') +
    '\n';

  // The leaf names everything above answers to; a TLS wildcard covers one label, so each handle
  // domain has its own. scripts/https-lib.sh adds the apps' names.
  const leafNames = [
    D,
    ...globe.pds.flatMap((p) => [host(p), handleWildcard(p)]),
    `plc.${D}`,
    on.relay && `relay.${D}`,
    on.jetstream && `jetstream.${D}`,
    on.slingshot && `slingshot.${D}`,
    on.pdsls && `pdsls.${D}`,
    'plc.directory',
    '*.devnet.internal',
  ].filter(Boolean);

  // The services https-up.sh waits on: the one-shots to finish, the rest to be healthy.
  const oneShots = ['init', on.relay && 'relay-init'].filter(Boolean);
  const globeEnv = [
    header('#').trimEnd(),
    '# The globe\'s facts for the https-* scripts. Nothing secret.',
    `SNOWGLOBE_GLOBE=${globe.globe}`,
    `DEVNET_DOMAIN=${D}`,
    `SNOWGLOBE_PDS=${globe.pds.map((p) => p.name).join(' ')}`,
    `SNOWGLOBE_SEED_PDS=${seed.name}`,
    // The PDS whose handles are <name>.<domain> (empty if none), the PDSes that take an invite
    // code, and every name under the domain a bare handle would take (scripts/snowglobe account).
    `SNOWGLOBE_BARE_PDS=${globe.pds.find((p) => p.bare_handles)?.name ?? ''}`,
    `SNOWGLOBE_INVITE_PDS=${globe.pds.filter((p) => p.invites === 'required').map((p) => p.name).join(' ')}`,
    `SNOWGLOBE_TAKEN=${[...RESERVED, ...globe.pds.map((p) => p.name), ...globe.grouphosts.map((g) => g.name), ...globe.apps.map((a) => a.local?.handles).filter(Boolean)].join(' ')}`,
    `SNOWGLOBE_AUTHORITY_PDS=${globe.lexicons.authority}`,
    `SNOWGLOBE_ONESHOTS=${oneShots.join(' ')}`,
    `SNOWGLOBE_SERVICES=${Object.keys(services).filter((s) => !oneShots.includes(s)).join(' ')}`,
    '',
  ].join('\n');

  return {
    'compose.yml': compose,
    'nginx/globe.conf': globeConf,
    'nginx/page.inc': pageInc,
    'leaf-names': leafNames.join('\n') + '\n',
    'globe.env': globeEnv,
  };
}
