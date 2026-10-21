# Snowglobe

Your own [AT Protocol](https://atproto.com) network, for testing and demos. A globe has its own
PDSes, PLC directory, relay and Jetstream, and nothing in it reaches Bluesky's network. It uses
https and the real network's sign-in (OAuth), so an app built for the real network runs against it
with no test-only code.

Run a globe on your machine with this repo, or open the one we host,
[lighthouse.snowglobe.at](https://lighthouse.snowglobe.at). [snowglobe.at](https://snowglobe.at)
says more about the project.

## What runs in a globe

One file, `snowglobe.yml`, says what a globe runs. The default file in this repo gives you:

- three PDSes, each at its own https name: the permissioned-spaces alpha, a current release, and an
  older release (0.4.5009);
- a PLC directory, which also answers as `plc.directory` for your app;
- a relay, Jetstream and Tap;
- Slingshot, for handle and DID lookups inside the network;
- PDSls, to browse the network's records;
- the network's own page, with its services, accounts and live activity;
- two test accounts, `alice` and `bob`.

Every name is under one domain, `local.snowglobe.at`, served by nginx with a certificate from a
local CA that the globe makes for itself. There is no AppView and no feed generator.
[The globe](docs/globe.md) shows the whole file and what each part does.

## Quick start

You need Docker with Compose, Node 20 or newer, and Linux or Windows with WSL 2. `snowglobe run`
also needs [bubblewrap](https://github.com/containers/bubblewrap) (on Debian or Ubuntu,
`sudo apt install bubblewrap`).

```bash
git clone https://github.com/OpenMeet-Team/snowglobe.git
cd snowglobe
npm install
export SG_PROJECT=mine     # the globe's Docker Compose project name; there is no default
bin/snowglobe.mjs up       # the first run pulls and builds images, which takes a while
```

Check it from the shell. `snowglobe run` runs a command that sees the globe's names, and
`--cacert` gives curl the globe's CA:

```bash
bin/snowglobe.mjs run curl -s --cacert data/https/ca.crt https://local.snowglobe.at/globe.json
```

To open the network's page, `https://local.snowglobe.at/`, in a browser on your own computer, set
up the proxy and trust the CA first ([From a browser on your own computer](docs/browser.md)).

Stop the globe with `bin/snowglobe.mjs down`. Add `-v` to delete its data too, every account
included.

To run your own app against a globe, see [Your app on a globe](docs/your-app.md).

## Platforms

Snowglobe runs on Linux, and on Windows under WSL 2. Both are tested. macOS is not supported:
nobody working on Snowglobe has a Mac to test on, and the quick stack, which ran wherever Docker
runs, is deprecated. If you try it on a Mac, please
[open an issue](https://github.com/OpenMeet-Team/snowglobe/issues) with what broke, or that it
worked.

## The quick stack (deprecated)

`npm run up` starts an older, smaller stack: one PDS, a PLC directory, Jetstream and Tap, on plain
http ports. An app has to be told it is on a test network to use it. It is deprecated, and new work
goes into the globe. Its documentation is in [The quick stack](docs/quick-stack.md).

## Documentation

- [The globe](docs/globe.md): what a `snowglobe.yml` holds, the commands, the globe's names, up and
  down, and what it writes.
- [Your app on a globe](docs/your-app.md): `snowglobe run`, and the tools that make an app's
  accounts, invite codes, lexicons and routes.
- [From a browser on your own computer](docs/browser.md): the proxy, launch flags, and trusting the
  CA.
- [How it works](docs/how-it-works.md): what changes for https, Slingshot, and the relay build.
- [Configuration](docs/configuration.md): the settings.
- [Testing Snowglobe](docs/testing.md): the test suite and the smoke run.
- [Example: atmo](docs/examples/atmo.md): an events app on a local globe.
- [The quick stack](docs/quick-stack.md) (deprecated): `npm run up`, its overlays, and composing it
  into your project.
- [Changelog](CHANGELOG.md): what changed in each version, and how to upgrade.

## Moved

These sections moved. The headings stay so that older links keep working.

### If a port is already taken

See [If a port is already taken](docs/quick-stack.md#if-a-port-is-already-taken).

### Integrating into your project

See [Integrating into your project](docs/quick-stack.md#integrating-into-your-project).

## License

MIT
