# How it works

## What runs, and how it's wired

- **Each PDS has an https name.** A PDS's `PDS_HOSTNAME` is `<name>.<domain>`, such as
  `main.local.snowglobe.at`. A PDS with `bare_handles` takes handles under the domain itself; every
  other PDS takes its own (`.regular.local.snowglobe.at`). Each runs with `PDS_DEV_MODE=false`, as
  on the real network.
- **nginx routes by name.** It answers on port 443 with a certificate from the snowglobe's CA, and
  passes the name through, so a PDS can answer `/.well-known/atproto-did` for a handle. A name
  nginx does not list gets no certificate.
- **The PDSes reach each other over TLS.** Inside Docker, nginx also answers to every PDS's name,
  and each PDS trusts the CA. Names under `app.<domain>` resolve to nginx instead of `127.0.0.1`
  (inside a container that would be the container itself), so a PDS can fetch your app's
  sign-in metadata.
- **The relay dials wss**, which is why it is built locally (see [The relay, built
  locally](#the-relay-built-locally)). Its `listHosts` shows a host only once it has sent an event.
- **Tap resync is not supported.** Tap fetches a repo to resync through an SSRF-safe transport that
  refuses nginx's address, so a resync fails here.
- **Jetstream** is at `ws://127.0.0.1:<SG_JETSTREAM_PORT>`, reading the relay over the Docker network.

## Slingshot: handles and DIDs inside the network

`slingshot` is [Slingshot](https://tangled.org/jola.dev/microcosm-rs/tree/main/slingshot) from
microcosm-rs, built from a pinned commit (`slingshot/Dockerfile`; upstream publishes no image), set
to the snowglobe's PLC and Jetstream. The public Slingshot cannot see an account on a snowglobe;
this one answers for it:

```sh
snowglobe run curl -sS --cacert ~/.local/share/snowglobe/ca/ca.crt \
  'https://slingshot.local.snowglobe.at/xrpc/com.bad-example.identity.resolveMiniDoc?identifier=alice.local.snowglobe.at'
# {"did":"did:plc:...","handle":"alice.local.snowglobe.at","pds":"https://alpha.local.snowglobe.at","signing_key":"zQ3..."}
```

It checks a handle both ways, which means it fetches `https://<handle>/.well-known/atproto-did`
from inside the compose network, and a handle's name exists nowhere but in nginx. So it runs in
the network namespace of `slingshot-dns`, a dnsmasq
that answers nginx's address for any name under `SG_DOMAIN` and nothing else, and its only
root is the snowglobe's CA. nginx reaches it as `slingshot-dns:8080`. `slingshot` is a name, not a
handle: `snowglobe account` refuses it. To recreate `slingshot-dns`, recreate `slingshot` with it.
To build another Slingshot, set `SG_SLINGSHOT_COMMIT` to a full microcosm-rs commit; it picks
the source and names the image.

## The relay, built locally

**The relay is built locally, not pulled.** Upstream's relay (`ghcr.io/bluesky-social/indigo:relay-<commit>`)
checks every host through an SSRF-safe transport that refuses loopback and private addresses, with
no setting to turn it off. Its admin `requestCrawl` accepts `localhost:<port>`, and the host check
then fails with `unsafe network address`, so the published image can never crawl a PDS on a snowglobe.
`relay/Dockerfile` builds the same upstream commit with `relay/allow-private-hosts.patch`, which
adds one opt-in setting, `RELAY_ALLOW_PRIVATE_HOSTS`, and copies the binary into the published
image. The setting covers both places the relay refuses those addresses: the host check, and the
firehose dialer for `wss://` hosts, which [a snowglobe](snowglobe.md) needs because its
PDS names resolve to nginx's private address. Pick another commit with `SG_RELAY_INDIGO_COMMIT`; it needs a published `relay-<commit>`
image, and the patch has to apply.
