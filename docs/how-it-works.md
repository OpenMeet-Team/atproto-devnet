# How it works

## How a globe differs from the quick stack

- **Each PDS at its https name.** A PDS's `PDS_HOSTNAME` is `<name>.<domain>`, such as
  `alpha.local.snowglobe.at`. The PDS with `bare_handles` takes handles under the domain itself
  (`.local.snowglobe.at`), and every other PDS takes its own (`.regular.local.snowglobe.at`). Every
  PDS runs with `PDS_DEV_MODE=false`, as it would on the real network, and keeps
  `PDS_DISABLE_SSRF_PROTECTION`, because everything it fetches here sits on an RFC 1918 address.
- **The PDSes reach each other over TLS.** Inside the compose network, nginx also answers to every
  PDS's name, and each PDS trusts the CA through `NODE_EXTRA_CA_CERTS`. Docker's DNS has no
  wildcard names, so each PDS preloads `https/app-names.cjs`, which looks up any name under `app.<domain>`
  (the app names) as nginx; inside a container the public DNS answer, 127.0.0.1, would be the container
  itself. Only the address changes: the request keeps the app's name, and TLS still checks the
  certificate for it.
- **nginx routes by name.** Each PDS's block takes its name and its handle wildcard, and passes Host
  through, so the PDS answers `/.well-known/atproto-did` for a handle. Of two matching wildcards nginx
  takes the longer, so `*.regular.local.snowglobe.at` wins over `*.local.snowglobe.at`. A name nginx does not list
  gets no certificate at all.
- **The relay dials wss.** `relay-init` registers every PDS by its name, which the relay treats as
  an https host. Their addresses are nginx's, a private one, so the relay is built with
  `relay/allow-private-hosts.patch`, whose `RELAY_ALLOW_PRIVATE_HOSTS` covers the firehose dialer as
  well as the host check (see [The relay, built locally](#the-relay-built-locally)). The CA is mounted into
  `/etc/ssl/certs`, which Go reads on top of its bundle. `RELAY_ALLOW_INSECURE_HOSTS` is dropped. The
  image has its own tag, `atproto-devnet-relay:https-<commit>`. The relay's `listHosts` shows a host
  only once it has sent an event.
- **Tap resync is not supported.** Tap follows the relay's stream, but it fetches a repo to resync
  through an SSRF-safe transport that refuses nginx's address, so a resync fails here.
- **Jetstream is unchanged**, at `ws://127.0.0.1:<SG_JETSTREAM_PORT>`, reading the relay over the
  compose network.

## Slingshot: handles and DIDs inside the network

`slingshot` is [Slingshot](https://tangled.org/jola.dev/microcosm-rs/tree/main/slingshot) from
microcosm-rs, built from a pinned commit (`slingshot/Dockerfile`; upstream publishes no image), set
to the globe's PLC and Jetstream. The public Slingshot cannot see an account on a globe;
this one answers for it:

```sh
bin/snowglobe.mjs run curl -sS --cacert ~/.local/share/snowglobe/ca/ca.crt \
  'https://slingshot.local.snowglobe.at/xrpc/com.bad-example.identity.resolveMiniDoc?identifier=alice.local.snowglobe.at'
# {"did":"did:plc:...","handle":"alice.local.snowglobe.at","pds":"https://alpha.local.snowglobe.at","signing_key":"zQ3..."}
```

It checks a handle both ways, which means it fetches `https://<handle>/.well-known/atproto-did`
from inside the compose network, and a handle's name exists nowhere but in nginx. So it runs in
the network namespace of `slingshot-dns`, a dnsmasq
that answers nginx's address for any name under `SG_DOMAIN` and nothing else, and its only
root is the globe's CA. nginx reaches it as `slingshot-dns:8080`. `slingshot` is a name, not a
handle: `snowglobe account` refuses it. To recreate `slingshot-dns`, recreate `slingshot` with it.
To build another Slingshot, set `SG_SLINGSHOT_COMMIT` to a full microcosm-rs commit; it picks
the source and names the image.

## The relay, built locally

**The relay is built locally, not pulled.** Upstream's relay (`ghcr.io/bluesky-social/indigo:relay-<commit>`)
checks every host through an SSRF-safe transport that refuses loopback and private addresses, with
no setting to turn it off. Its admin `requestCrawl` accepts `localhost:<port>`, and the host check
then fails with `unsafe network address`, so the published image can never crawl a PDS on a globe or the quick stack.
`relay/Dockerfile` builds the same upstream commit with `relay/allow-private-hosts.patch`, which
adds one opt-in setting, `RELAY_ALLOW_PRIVATE_HOSTS`, and copies the binary into the published
image. The setting covers both places the relay refuses those addresses: the host check, and the
firehose dialer for `wss://` hosts, which [a globe](globe.md) needs because its
PDS names resolve to nginx's private address. Pick another commit with `SG_RELAY_INDIGO_COMMIT`; it needs a published `relay-<commit>`
image, and the patch has to apply.
