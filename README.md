# Snowglobe

A self-contained [AT Protocol](https://atproto.com) network for testing and demos, with its own PDS,
PLC directory and Jetstream, and nothing in it reaches Bluesky's network. This repo runs one on your
machine for local development and CI, on Docker Compose, so it works wherever Docker Compose does. [snowglobe.at](https://snowglobe.at) says what Snowglobe is, and lists the globes we host on a
server, such as [lighthouse.snowglobe.at](https://lighthouse.snowglobe.at).

The default stack is one PDS, a PLC directory, Jetstream and Tap. That is enough to create accounts, publish
and read records, and test Jetstream consumers. Optional overlays add a PDS that supports
permissioned spaces, two more PDS builds beside it, a local relay that crawls them all, and https
names with a local CA. There is no AppView and no feed generator.

## Documentation

- [The https devnet](docs/globe.md): a globe from a `snowglobe.yml`, its names, the commands, up
  and down, and what it writes.
- [Your app on a globe](docs/your-app.md): `snowglobe run`, and the tools that make an app's
  accounts, invite codes, lexicons and routes.
- [From a browser on your own computer](docs/browser.md): the proxy, launch flags, and trusting the CA.
- [How it works](docs/how-it-works.md): how the https devnet differs from the http stacks, Slingshot,
  and the relay build.
- [Configuration](docs/configuration.md): the settings.
- [Testing Snowglobe](docs/testing.md): the test suite and the smoke run.
- [Example: atmo](docs/examples/atmo.md): an events app on the https devnet.
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
