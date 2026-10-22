# Changelog

Changes to the default stack that existing setups will notice:

## Unreleased

- **The default snowglobe is one PDS now.** `snowglobe.default.yml` runs one current PDS, `main`,
  with the PLC, Jetstream, Slingshot, PDSls and the accounts `alice` and `bob`, and holds commented
  examples for adding more. The old default (the permissioned-spaces alpha, a current release and an
  older one, with a relay and a lexicon authority) is `docs/examples/atmo.yml`. To keep it, copy that file to
  `snowglobe.yml`. A snowglobe that was brought up from the old default keeps its own `snowglobe.yml`
  or `--default` choice: bring it up from `docs/examples/atmo.yml`, not the new default, or it starts over under
  new PDS names (unchecked: how an existing one reacts to the new file).
- **The docs moved.** The README is short now, and the guides are under `docs/`, starting with
  [The snowglobe](docs/snowglobe.md). The quick stack (`npm run up`) is gone; the [v0.2.0 tag](https://github.com/OpenMeet-Team/snowglobe/tree/v0.2.0) has it.
- **A snowglobe keeps its state in your own account, not in the checkout.** It is in
  `~/.local/share/snowglobe/<name>/` (under `XDG_DATA_HOME` if you set it, `%LOCALAPPDATA%\snowglobe`
  on Windows), where `<name>` is the `globe:` line of its `snowglobe.yml`, and the Docker Compose
  project has that name too unless `SG_PROJECT` is set. There is one CA per user, in `ca/` beside the
  snowglobes' folders. A command finds the `snowglobe.yml` in the folder you are in or the nearest
  one above; `up` with none refuses, and `up --default` runs the default file, whose name is
  `snowglobe` (it was `devnet` for a while; see the rename below). Nothing is moved for you. A checkout that still holds a snowglobe in its `data/` makes
  `up` stop, change nothing, and print the commands that move the files; to keep the running
  containers and volumes, run `up` again with `SG_PROJECT` set to the old project's name, as it
  prints. Either way you trust a new CA once, with `snowglobe trust`.
- **Apps are at `<app>.app.<domain>`, not `<app>.devnet.internal`.** Public DNS already answers
  those names, and the CA no longer vouches for `devnet.internal`. To move an app, in this order:
  run `snowglobe up`, which redoes the routes and the certificate and recreates nginx; then change
  the app's `OAUTH_PUBLIC_URL`, its OAuth client ids and its allowed hosts (for vite,
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`) to `<app>.app.<domain>`; then restart anything running
  under `snowglobe run`, which reads its names when it starts. `app` is now a reserved name: `up`
  refuses a saved route whose handle ending is `app`. The browser proxy's PAC follows by itself;
  Chrome launch flags drop the `MAP *.devnet.internal` rule.
- **An app's settings come from `snowglobe env`, and `data/devnet.env` is gone.** `up` no longer
  writes it, and removes an old one. Map the addresses an app needs under the app in `snowglobe.yml`
  (`env:`), then `eval "$(snowglobe env)"`, `snowglobe env --dotenv > .env.local`, or
  `snowglobe run`. Anything that sourced `devnet.env` reads these instead
  ([An app's settings](docs/your-app.md#snowglobe-env-know-where-things-are)). Account names in the file
  must now be unique.
- **The default snowglobe is named `snowglobe`, not `devnet`, and its Docker names follow.** The
  state folder is `~/.local/share/snowglobe/snowglobe`, the Docker network is `snowglobe`, the images
  are `snowglobe-dns`, `-proxy`, `-pdsls`, `-relay` and `-slingshot`. Your CA is kept. If you made the default snowglobe under the old name, `up --default` stops
  and changes nothing; it prints the commands. To keep its accounts, move the folder and keep the old
  compose project: `mv ~/.local/share/snowglobe/devnet ~/.local/share/snowglobe/snowglobe`, then
  `SG_PROJECT=devnet snowglobe up --default`. To drop it, `down -v` it and delete the folder.
  Either way the old Docker network `devnet_atproto-devnet` is left behind: remove it with
  `docker network rm devnet_atproto-devnet` once nothing uses it. The quick stack and the old
  `DEVNET_*` setting names are unchanged.
- **The network page's facts are at `/snowglobe.json`, not `/globe.json`.** `up` writes
  `https/nginx/snowglobe.json` and the page reads it. Anything that fetched `globe.json` from a
  snowglobe uses the new name after its next `up`.
- **`snowglobe trust` puts your CA in the system and browser trust stores.** `--dry-run` shows what it
  would do, `--remove` undoes it. macOS and native Windows are untried.
- **Tap is off by default.** Nothing in the default snowglobe attaches to it. Turn it on with
  `services: { tap: true }`.
- **A globe made before 2026-10-20 failed on its next `up`.** Snowglobe builds the `slingshot-dns`,
  `proxy` and `pdsls` images itself, and Docker keeps an old copy when their source changes. With
  the old copies, `up` stops with `cannot join network namespace` while `slingshot-dns` restarts.
  Fixed since: each of those images is tagged by a hash of its Dockerfile and the files it copies, so
  a change rebuilds it, and a failed compose step in `up` says how to clear a stale image. To rebuild
  by hand, after an `up` has rendered the snowglobe:
  `docker compose -p <project> --project-directory . -f <state>/globe/compose.yml build slingshot-dns proxy pdsls`.
- **The repo is `OpenMeet-Team/snowglobe`, and every setting is `SG_*`.** It was
  `OpenMeet-Team/atproto-devnet` until 2026-10-20; GitHub sends the old address here. Projects that
  use it still look for it beside them at `../atproto-devnet`, so clone it under that name. The
  settings that were `DEVNET_*` and `SNOWGLOBE_*` are `SG_*` with the same ending (`DEVNET_BIND` is
  `SG_BIND`, `SNOWGLOBE_FILE` is `SG_FILE`). The old names still work for now, from the environment
  or `.env`: `bin/snowglobe.mjs` warns once and reads them as the new ones, and the plain stack's
  compose files and scripts fall back to them. Files written before (`data/devnet.env`,
  `data/accounts.env`, the rendered globe) are read either way.
- **The https devnet's default domain is `local.snowglobe.at`, not `devnet.test`.** A PDS refuses
  an OAuth client under `.test`, so at `devnet.test` nobody could sign in through a group host or
  PDSls. A globe run from the default file, or from a `snowglobe.yml` that names no domain, moves on
  its next `up`, which stops at the certificates: the CA was made for `devnet.test` and can't vouch
  for the new names. To keep the old name and its accounts, add `domain: devnet.test` to its
  `snowglobe.yml`. To move, run `bin/snowglobe.mjs down -v` (it drops every account), delete
  `data/https/ca.*`, run `up`, and trust the new `ca.crt`. The browser proxy's PAC follows the domain
  by itself; Chrome launch flags have to name the new one. The plain http stack keeps `devnet.test`.
- **The https devnet is rendered from a `snowglobe.yml` now, and a running one starts over.**
  `snowglobe up` writes `data/globe/` with `bin/snowglobe.mjs render` (from `SG_FILE`, else
  `snowglobe.default.yml`: the same alpha, regular and prod) and runs that one compose file;
  `docker-compose.https.yml` is gone. Each PDS is its own service on the compose network, named
  `pds-<name>`, so the alpha is `pds-alpha`, not `pds`, and its data volume is `pds-alpha-data`, not
  `pds-data` (`pds-regular-data` and `pds-prod-data` keep their names). On a devnet brought up
  before this, the alpha would start on a new, empty volume while the PLC still holds its accounts'
  DIDs, and the old `pds` container would be left running beside it. So take such a devnet down with
  the previous checkout first, `-v` included, and the next `snowglobe up` starts it fresh. The plain
  http stacks are unchanged.
- **The `scripts/https-*` tools are gone: use `bin/snowglobe.mjs up`, `down` and `run`.** To keep
  the old layout, check out tag `v0.2.0`, the last version that has them. `https-up.sh` is `up`
  (the file can also be its argument, and `up` now seeds the file's `accounts`, `lexicons.publish`
  and `apps`), `https-down.sh` is `down`, which takes
  `-v` and nothing else, and `https-run` is `run`. `run` now maps every name the rendered globe
  answers to, each PDS in the file included, not a fixed three, to `SG_BIND`. `data/devnet.env`
  takes the Jetstream, maildev and proxy ports from `.env` too, as compose does.
- **snowglobe is `bin/snowglobe.mjs` now.** Its code moved from `scripts/` to `lib/`, one file per
  command under `lib/commands/`. `scripts/snowglobe` still runs it, so a script that calls the old
  path keeps working.

## v0.2.0 (2026-10-20)

- **The PDS no longer forwards to Bluesky's AppView.** `app.bsky.*` reads and any method the PDS
  doesn't implement now go to `https://appview.invalid` and fail with `502 UpstreamFailure`.
  Bluesky's AppView never indexed devnet accounts, so for those accounts nothing useful is lost.
- **DID resolution works again on current `pds:0.4` pulls.** Since `@atproto/pds` 0.5.34, the PDS
  refuses to resolve DIDs through an `http://` PLC unless SSRF protection is off, and the floating
  `pds:0.4` tag now pulls 0.5.36. Without the fix, `describeRepo`, OAuth and anything else that
  resolves a new DID fails with `Forbidden protocol "http:"`. The PDS now sets
  `PDS_DISABLE_SSRF_PROTECTION=true`, so it can also fetch private addresses, such as an OAuth client's
  metadata on your machine. The default stack still uses http. The
  [https devnet](docs/snowglobe.md) keeps SSRF protection off too, for another reason: every address
  a PDS fetches from there (nginx, the PLC, your machine) is a private one, and the protected fetch
  refuses private addresses.
- **init reseeds when `data/` is stale.** `data/` outlives `npm run down`. init used to skip seeding
  whenever `data/accounts.json` existed, leaving credentials for accounts that were gone. It now
  checks that the first recorded account exists on the running PDS and reseeds if it doesn't, so
  `data/accounts.env` gets new DIDs and a new invite code.
- **The PDS runs as root.** Release images already did. This lets `SG_PDS_IMAGE` take monorepo
  images, which default to `node`.
- **The https devnet's nginx config is a template now: rerun `bin/snowglobe.mjs up` after pulling.**
  `https/nginx.conf` became `https/nginx.conf.template`, which the nginx image fills in with
  `SG_DOMAIN` when it starts. An nginx container made before the pull still mounts the old file,
  and once the file is gone that container cannot start again (Docker leaves an empty directory in
  its place). `snowglobe up` recreates it on the new mount. Checking out an older version needs the
  same rerun, the other way round. An overlay that mounts its own config over
  `/etc/nginx/conf.d/default.conf` should mount it at `/etc/nginx/templates/default.conf.template`
  instead, and one that replaces nginx's command must keep the image's entrypoint, which writes the
  template out.

## v0.1.0 (2026-02-12)

The first release.
