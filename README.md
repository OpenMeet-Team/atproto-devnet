# Snowglobe

Your own isolated [AT Protocol](https://atproto.com) network, for testing, research, and demos. A snowglobe has its own
PDSes, PLC directory, relay and Jetstream, and nothing in it reaches Bluesky's network. It uses
https and the real network's sign-in (OAuth), so an app built for the real network runs against it
with no test-only code.

**Why?** I use it for developing features against the spaces alpha PDS, a group host, and atmo.rsvp.
If you are developing and experimenting with atproto apps, lexicons, OAuth, that might impact the users of the atproto network, 
this is a safe way to run such experiments.

**How?** Run a snowglobe on your machine with this repo, or open the one we host,
[lighthouse.snowglobe.at](https://lighthouse.snowglobe.at). [snowglobe.at](https://snowglobe.at)
says more about the project.

## What runs in a snowglobe

One file, `snowglobe.yml`, says what a snowglobe runs. [`snowglobe.default.yml`](snowglobe.default.yml)
is the one to start from. It gives you:

- one current PDS, at `https://main.local.snowglobe.at`, with two test accounts, `alice` and `bob`;
- a PLC directory, which also answers as `plc.directory` for your app;
- Jetstream, for the stream of writes;
- Slingshot, for handle and DID lookups inside the network;
- PDSls, to browse the network's records;
- the network's own page, with its services, accounts and live activity.

The file also holds commented examples for adding more, up to a full setup: more PDSes (a relay turns
on by itself), the permissioned-spaces alpha, a lexicon authority, Tap, a group host, and your own app.
[`docs/examples/atmo.yml`](docs/examples/atmo.yml) is a larger file, with three PDSes, a relay and a
lexicon authority, that [Example: atmo](docs/examples/atmo.md) builds on.

Every name is under one domain, `local.snowglobe.at`, served by nginx with a certificate from a
local CA that the snowglobe makes for itself. There is no AppView and no feed generator.
[The snowglobe](docs/snowglobe.md) shows the whole file and what each part does.

## What you need

A snowglobe only works when your app, or your browser, can reach it **by name**. Every service
(each PDS, the PLC, the relay, Slingshot, PDSls, the network's page, your own apps) has its own https
name under `local.snowglobe.at`, and handles, sign-in (OAuth) and DID documents all carry those
names. So there are three requirements:

1. **Docker with Compose, Node 20 or newer, and Linux or Windows with WSL 2.** To run your own app,
   or its tests, on your machine against the snowglobe, you also need
   [bubblewrap](https://github.com/containers/bubblewrap) (`sudo apt install bubblewrap` on Debian
   or Ubuntu). `snowglobe run` uses it, and an app on your machine needs `snowglobe run` to reach
   `plc.directory` and the PDSes by their names. You don't need it to bring a snowglobe up or to
   look at one in a browser.
2. **The names must reach nginx**, the one service the snowglobe publishes on port 443.
   - Docker and your browser on the same computer: usually nothing to do, because public DNS
     answers every name under `local.snowglobe.at` with `127.0.0.1`. Some routers drop such
     answers (DNS rebinding protection), and then the browser says "server not found". Fixes are in
     [When the browser cannot open it](docs/browser.md#when-the-browser-cannot-open-it).
   - Docker in a dev container or on another machine: run the snowglobe's proxy and point your
     browser at it ([From a browser on your own computer](docs/browser.md)).
   - A command run with `snowglobe run`: the names are already set up inside it.
3. **The snowglobe's CA must be trusted**, so https works without warnings. `snowglobe trust` does it
   on the machine that runs Docker; [From a browser on your own computer](docs/browser.md) covers
   the other cases.

**Why not just use ports?** The PDSes are not published on ports at all: only nginx (443), the PLC,
Jetstream and MailDev are. A PDS's address is its name, and that name is what a DID document, a
handle lookup and an OAuth sign-in resolve to, so an app has to be told it is on a test network to
use a port instead. A snowglobe can still be small: a file with one PDS, the PLC and Jetstream
checks and renders ([The file and the commands](docs/snowglobe.md#the-file-and-the-commands)). It
keeps the https names, and they are what make an app run unchanged.

## Quick start

```bash
git clone https://github.com/OpenMeet-Team/snowglobe.git
cd snowglobe
npm install
cp snowglobe.default.yml snowglobe.yml   # the file says what your snowglobe runs; edit it freely
bin/snowglobe.mjs up                     # the first run pulls and builds images, which takes a while
```

Now try it. `snowglobe run` runs a command that can reach the snowglobe by name, and `--cacert`
gives curl the snowglobe's certificate authority (CA), so it trusts the snowglobe's https:

```bash
# Sign up a new account, then look up alice's account through Slingshot
bin/snowglobe.mjs account carol CAROL
bin/snowglobe.mjs run curl -s --cacert ~/.local/share/snowglobe/ca/ca.crt \
  'https://slingshot.local.snowglobe.at/xrpc/com.bad-example.identity.resolveMiniDoc?identifier=alice.local.snowglobe.at'
```

To look around in a browser, you need two things: the browser has to trust the snowglobe's
certificate, and it has to be able to find the snowglobe. If Docker runs on the same computer as your
browser, run `bin/snowglobe.mjs trust` and open `https://local.snowglobe.at/`, the network's page,
which lists every service, account and write. If Docker runs in a dev container or on another
machine, your browser also needs the snowglobe's small proxy, which sends the snowglobe's names to
it; [From a browser on your own computer](docs/browser.md) walks through both.

The default snowglobe comes with one app to look at, [PDSls](docs/snowglobe.md#pdsls-browsing-the-networks-records),
the record browser. `https://pdsls.local.snowglobe.at/at://alice.local.snowglobe.at` shows alice's repo,
once your browser can reach the snowglobe as above.

Stop the snowglobe with `bin/snowglobe.mjs down`. Add `-v` to delete its data too, every account
included. Everything a snowglobe makes is kept in your own account, in
`~/.local/share/snowglobe` (or under `XDG_DATA_HOME`), and nothing in the checkout
([Which snowglobe, and where it lives](docs/snowglobe.md#which-snowglobe-and-where-it-lives)).

To run your own app inside of a snowglobe, see [Your app in a snowglobe](docs/your-app.md).

## Platforms

Snowglobe runs on Linux, and on Windows under WSL 2. Both are tested. macOS is not supported, but we'd love to.
If you try it on a Mac, please
[open an issue](https://github.com/OpenMeet-Team/snowglobe/issues) with what broke, or that it
worked, and we'd love to experiment with you.

## Documentation

- [The snowglobe](docs/snowglobe.md): what a `snowglobe.yml` holds, the commands, the snowglobe's names, up and
  down, and what it writes.
- [Your app in a snowglobe](docs/your-app.md): `snowglobe run`, and the tools that make an app's
  accounts, invite codes, lexicons and routes.
- [From a browser on your own computer](docs/browser.md): the proxy, launch flags, and trusting the
  CA.
- [How it works](docs/how-it-works.md): what changes for https, Slingshot, and the relay build.
- [Configuration](docs/configuration.md): the settings.
- [Testing Snowglobe](docs/testing.md): the test suite and the smoke run.
- [Example: atmo](docs/examples/atmo.md): an events app on a local snowglobe.
- The older plain-http stack (`npm run up`) is not in this version. Its code and README are in the
  [v0.2.0 tag](https://github.com/OpenMeet-Team/snowglobe/tree/v0.2.0) (v0.1.0 has the first version of it).
- [Changelog](CHANGELOG.md): what changed in each version, and how to upgrade.

## License

MIT
