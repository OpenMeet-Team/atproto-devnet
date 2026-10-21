# Changelog

Changes to the default stack that existing setups will notice:

## Unreleased

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
  [https devnet](docs/globe.md#the-https-devnet) keeps SSRF protection off too, for another reason: every address
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
