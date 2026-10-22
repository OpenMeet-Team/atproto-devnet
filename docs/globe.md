# The snowglobe

A snowglobe is the network a `snowglobe.yml` describes ([The file and the commands](#the-file-and-the-commands)).
`bin/snowglobe.mjs up` renders the file into one compose file (`bin/snowglobe.mjs render`) and
brings it up; with no file named, it uses `snowglobe.default.yml`. Every PDS sits at an https name,
as on the real network, so an app built for the real network runs against it with no test-only
code. The [quick stack](quick-stack.md) is the other way round: it serves every PDS at
`http://localhost:<port>`, so an app has to allow plain http and ask its PLC instead of
`plc.directory`.

It runs on Linux, and on Windows under WSL 2; both are tested with `node scripts/smoke.mjs`
([Test suite](testing.md#test-suite)). macOS is not supported yet: nobody working on it has a Mac to test on.
If you have one, please try it and [open an issue](https://github.com/OpenMeet-Team/snowglobe/issues)
with what broke, or that it worked; we'll add Mac support over time.

With the default file:

| Name | Served by |
| --- | --- |
| `alpha.local.snowglobe.at`, `*.local.snowglobe.at` | `pds-alpha`, the spaces alpha (`79d6307e`), and its handles; invites required |
| `regular.local.snowglobe.at`, `*.regular.local.snowglobe.at` | `pds-regular`, a current release, and its handles |
| `prod.local.snowglobe.at`, `*.prod.local.snowglobe.at` | `pds-prod`, an older release (0.4.5009, pinned by digest), and its handles |
| `plc.directory` | the snowglobe's own PLC |
| `slingshot.local.snowglobe.at` | `slingshot`, which answers a handle's DID and PDS ([Slingshot](how-it-works.md#slingshot-handles-and-dids-inside-the-network)) |
| `plc.local.snowglobe.at`, `relay.local.snowglobe.at`, `jetstream.local.snowglobe.at` | the PLC, the relay and Jetstream, as a snowglobe names them, so an app's browser code reaches them over https too |
| `pdsls.local.snowglobe.at` | `pdsls`, the record browser ([PDSls](https://pds.ls)) for this network (below) |
| `local.snowglobe.at` | nginx itself: the network's page, the one a snowglobe serves at its bare name (below) |
| `<name>.app.<domain>` | an app on this machine, at the port `bin/snowglobe.mjs app` recorded for `<name>` |
| `*.<ending>.local.snowglobe.at` | the app that claimed `<ending>` with `bin/snowglobe.mjs app`, for the handles it hands out |

Each PDS in the file is a service of its own, `pds-<name>`, at `<name>.local.snowglobe.at`; the one with
`bare_handles` takes `*.local.snowglobe.at`, and every other its own `*.<name>.local.snowglobe.at`. nginx answers
all of them on `127.0.0.1:443` with one certificate from a local CA. Each PDS's public URL, OAuth
issuer and DID document endpoint is `https://<its name>`, and the relay crawls every PDS as a
`wss://` host. Inside the compose network nginx also answers to every PDS's name, so the PDSes,
the relay (and Tap, when on) reach each other over TLS; no service shares another's network but Slingshot. On the machine, the names resolve to `127.0.0.1` only for
commands run under `bin/snowglobe.mjs run`, so every other program still reaches the real
`plc.directory`.

`local.snowglobe.at` is the default file's domain, and every name in the table above (and in the
rest of these docs) uses it. The name is ours, and its public DNS points every name under it at
`127.0.0.1`, so a lookup that misses the snowglobe's own mapping lands on your machine, not on someone
else's server. Pick another domain freely, but not one under `.test`, `.local`, `.localhost`,
`.invalid` or `.example`: the stack comes up there, but a PDS refuses an OAuth client at such a name,
so nobody can sign in through a group host or PDSls. `SG_DOMAIN` replaces it. Only the snowglobe reads it; the quick stack
keeps `SG_PDS_HOSTNAME` and `SG_HANDLE_DOMAIN`. Set it in the environment or in `.env` and
the same stack comes up under that domain: `alpha.<domain>` with handles at `<name>.<domain>`,
`regular.<domain>`, `prod.<domain>`. `plc.directory` stays as it is; apps follow the domain, at `<name>.app.<domain>`.
In `.env`, write the domain itself (quotes, `export` and a trailing comment are fine); the scripts
refuse a `${...}` there, which compose would expand and they would not. A checkout keeps one domain,
because its CA can vouch only for the domain it was made for ([The CA](browser.md#the-ca)); for a second
domain, use a second checkout.

The snowglobe knows no app. It has no app's accounts, invite codes, lexicons or ports. It gives an app
tools to make its own ([Your app on a snowglobe](your-app.md)), and using them is optional.

## The network's page

`https://local.snowglobe.at/` is the network's own page (`page/index.html`): every service and its
health, every account on each PDS, the apps `snowglobe app` routed, and the network's writes
from Jetstream, the last week's and then live. nginx serves it with this snowglobe's relays (`page/devnet.conf`), a fixed GET-only path per read, so the page
asks nothing but `local.snowglobe.at`. `snowglobe render` and `snowglobe app` write what it lists into
`<state>/https/nginx/globe.json`. Open it from a browser set up as in [From a browser on your own
computer](browser.md#from-a-browser-on-your-own-computer), or `bin/snowglobe.mjs run curl -s https://local.snowglobe.at/globe.json`.

## PDSls: browsing the network's records

`https://pdsls.local.snowglobe.at/` is [PDSls](https://github.com/notjuliet/pdsls), the record browser at
pds.ls, for this network: `https://pdsls.local.snowglobe.at/at://alice.local.snowglobe.at` shows her repo, its
collections and records, as `https://pds.ls/at://...` does on the real network. Apps that link to
pds.ls point their links here on a snowglobe. `pdsls/` builds it from a pinned upstream commit
with `pdsls/network.patch`, which lets the page that loads it give it a network's addresses (unset,
it is the public network's, unchanged), and `pdsls/server.mjs` serves it with this network's: the PLC
at `plc.local.snowglobe.at`, Jetstream and the relay as the stream page's defaults, and the lexicon authority
for every NSID. It looks up handles and `did:web` documents for names under `local.snowglobe.at` only, and
turns off what has no stand-in here: DNS lookups, Bluesky search and avatars, backlinks, Spacedust,
the public font host, link previews. Signing in uses a client at its own address, so editing records
works against the snowglobe's PDSes.

A record's Schema tab shows its lexicon when the authority holds it and pdsls's parser accepts it.
Measured 2026-10-19: the opensocial proposal's lexicons (a `space` definition, a `space-ref` format)
and atmo's permission set fail that parser, as they would on pds.ls; the record view is unaffected.

## The file and the commands

One file says what a snowglobe runs: `snowglobe.yml`. It belongs in an app's repo, next to the lexicons
it publishes, and is committed. Everything the snowglobe makes while it runs (the CA's key, passwords,
invite codes, app routes) goes in the snowglobe's state folder, in your own account and in no repo
([What it writes](#what-it-writes)).

```yaml
globe: bookclub                  # lowercase letters and digits; the snowglobe's own name
domain: local.snowglobe.at       # every name below is under it (local.snowglobe.at if left out)

pds:                             # at least one; each is pds-<name> at https://<name>.<domain>
  - name: alpha
    image: spaces-alpha          # a short name (pinned by digest), or any image reference
    bare_handles: true           # handles <name>.<domain>; at most one PDS. Others: <name>.<pds>.<domain>
    invites: required            # open (default) or required
  - name: regular
    image: ghcr.io/bluesky-social/pds:0.4.5037

grouphosts:                      # optional; each is grouphost-<name> at https://<name>.<domain>
  - name: gh                     # its groups' handles are <group>.gh.<domain>
    kind: opensocial             # atproto-group-host, the only kind so far
    build: ../atproto-group-host # a folder with a Dockerfile, from this file's folder; or image:

services:                        # each true or false; these are the defaults
  relay: auto                    # auto: on when there is more than one PDS
  jetstream: true
  tap: false                     # off by default; it syncs and backfills repos for an app that attaches to it
  slingshot: true                # needs jetstream
  pdsls: true

lexicons:
  authority: alpha               # the PDS lex-authority is made on (the bare-handle PDS by default)
  publish: lexicons              # a folder next to this file; up publishes every lexicon in it

accounts:                        # <name>@<pds>; up makes each one
  - owner@alpha
  - reader@regular

apps:
  - name: bookclub
    local: { port: 5173, handles: bc }   # https://bookclub.app.local.snowglobe.at and handles *.bc.<domain>
```

`bin/snowglobe.mjs check` says what is wrong with a file, one line per problem, and touches
nothing. A name used twice, a PDS named like a service, an app's handle ending that is a PDS's
name, a handle longer than DNS allows: each fails here, before anything starts. `hosted`, an
app's `hosted` and `services.cdn` (an image service) are read and checked for a snowglobe hosted on a
server; a local snowglobe does not use them. A hosted snowglobe, such as lighthouse, also runs one PDS and
one group host today, whatever its file lists.

**Group hosts** are optional. Each one runs beside the PDSes as a service of its own at
`https://<name>.<domain>`, with every group's handle under `<name>.<domain>`; nginx, the
certificate and the network page (its health, and its groups under accounts) get each one, as they
get each PDS. The one kind, `opensocial`, is
atproto-group-host, which is not public yet and publishes no image,
so `up` builds it from a checkout with the repo's own Dockerfile, on every run (Docker's cache keeps
an unchanged one quick). The checkout is the group host's `build` folder in the file, else
`SG_OPENSOCIAL_BUILD` (a path from where you run the command), so a file shared between
machines can leave it out:

```bash
SG_OPENSOCIAL_BUILD=../atproto-group-host bin/snowglobe.mjs up ../myapp/snowglobe.yml
```

`image:` in place of `build` runs a built image instead. With neither, and the variable unset,
`render` and `up` stop before anything changes and say so. A group host makes its groups' accounts
itself, takes no invite code, and resolves every name under the domain through nginx, its members'
handles too. Under `snowglobe run`, list a group's handle in `HTTPS_RUN_EXTRA_NAMES`, as for any
handle.

`up` seeds what the file asks for, every run, and a rerun changes nothing that is already there:

- **accounts**: each one is made with `snowglobe account` ([Tools for an app](your-app.md#tools-for-an-app)). Its login goes to
  `<state>/accounts.env` as `<NAME>_*` on the PDS with bare handles (else the first), where init's
  `alice` and `bob` are, so `alice@alpha` is init's own alice; on any other PDS as
  `<NAME>_<PDS>_*`, so `reader@regular` is `READER_REGULAR_*`. Passwords are generated and never
  printed.
- **lexicons.publish**: every lexicon in the folder, at any depth, goes into the authority as
  `snowglobe lexicons` does; an unchanged one is left alone, and other JSON is skipped.
- **apps[].local**: the route `snowglobe app <name> <port> [<handles>]` would make, set before the
  certificate and nginx, so both have it. A route made by hand with `snowglobe app` stays.

The commands, each `bin/snowglobe.mjs <command>`:

| Command | What it does |
| --- | --- |
| `check [<file>]` | checks a file |
| `render [<file>] [--out <dir>] [--domain <domain>]` | writes the snowglobe it describes into `<state>/globe/`, or `<dir>` (`up` does this itself); `--domain` replaces the file's domain, for a copy beside another snowglobe |
| `certs [--check]` | makes your CA, once, and the leaf nginx serves (`up` does this itself) |
| `trust [--remove] [--dry-run] [--no-sudo]` | puts your CA in the system and browser trust stores, or takes it out ([From a browser on your own computer](browser.md)) |
| `up [<file> \| --default]` | brings the snowglobe up and seeds it ([Up and down](#up-and-down)) |
| `down [-v]` | stops it; `-v` drops its volumes too |
| `run [--] <cmd>` | runs a command that reaches the snowglobe at the real network's names (Linux) |
| `account`, `invite`, `lexicons`, `app` | make an app's own accounts, invite codes, lexicons and routes ([Tools for an app](your-app.md#tools-for-an-app)) |

Exit 2 means
the command was called wrong, 1 that the snowglobe refused, 3 that `up` or `down` refused the shared
snowglobe.

## Which snowglobe, and where it lives

A command acts on one `snowglobe.yml`: the one you name, else `SG_FILE`, else the nearest
`snowglobe.yml` in the folder you are in or above it. `up` with none of these refuses, because
starting something by accident is worse than asking; `up --default` runs the default file in this
repo, `snowglobe.default.yml` (alpha, regular and prod, with `alice` and `bob`). The other commands
fall back to that default.

The file's `globe:` line names the snowglobe. The name gives its state folder, `<state>`, which is
`<state root>/<name>` in your own account, not in the checkout: `~/.local/share/snowglobe` on Linux
and WSL (under `XDG_DATA_HOME` if you set it), `%LOCALAPPDATA%\snowglobe` on Windows. Beside the
snowglobes' folders is `ca/`, your one certificate authority, which they all use. The name also
names the Docker Compose project, unless `SG_PROJECT` is set. A state folder remembers the file that
owns it, and `up` refuses a second file that says the same `globe:`: give one of them another name.

## Up and down

The scripts refuse the shared project `devnet-spaces` unless `SG_RESET_OK=1`, and exit before
calling docker.

```bash
bin/snowglobe.mjs up --default   # certificates, two-pass authority boot, <state>/devnet.env
bin/snowglobe.mjs down           # stop it; -v also drops its volumes (every account and DID)
```

Both run the one compose file `snowglobe up` last rendered, from the repo root:

```bash
bin/snowglobe.mjs up ../myapp/snowglobe.yml   # another snowglobe than the default
docker compose -p <project> --project-directory . -f <state>/globe/compose.yml ps
```

`snowglobe up` is safe to rerun; a rerun leaves the running services as they are, and only the
one-shot `init` and `relay-init` run again. A rerun on a changed file stops what the file no longer
runs, and when it adds a PDS beside a running relay it restarts the relay, which otherwise can wait
a long time before it redials a PDS that went away and came back. It refuses a PDS named for a handle ending an app
claimed with `snowglobe app`, before it writes anything. It makes the leaf certificate if there is
none, brings the stack up, makes the lexicon authority (`lex-authority.local.snowglobe.at` on the file's
`lexicons.authority` PDS, the alpha by default),
brings the stack up again with `SG_LEXICON_AUTHORITY_DID` so every PDS starts with it, and writes
`<state>/devnet.env`. The base init still seeds `alice` and `bob` and a 100-use `SG_INVITE_CODE`
into `<state>/accounts.env`, on the PDS with bare handles (else the first), as it does for the http
stacks. Nothing else is seeded.

Published ports, all on `127.0.0.1` only: 443 (nginx), the PLC (`SG_PLC_PORT`), Jetstream
(`SG_JETSTREAM_PORT`, `SG_JETSTREAM_METRICS_PORT`) and maildev (`SG_MAILDEV_WEB_PORT`,
`SG_MAILDEV_SMTP_PORT`). Set those to run a second snowglobe beside another; pass the same
values on every run. The PDS, relay, Tap and Postgres ports are not published: reach a PDS by its
https name. nginx needs port 443 itself, so a second snowglobe also takes another loopback
address, `SG_BIND` (for example `127.0.0.2`; the default is `127.0.0.1`). Set it in the
environment or `.env`; the scripts read it as compose does, `snowglobe run` maps the names to it, and
`<state>/devnet.env` records it. The scripts refuse anything but a `127.x.y.z` address: the snowglobe's
logins are throwaway, so it is never published beyond this machine.

`snowglobe down` runs `docker compose down` (with `-v` when given) and never deletes the state folder. The PLC's
database is a named volume (`plc-db`), so a `down` without `-v` keeps every DID along with the
PDSes. After `-v`, the next `snowglobe up` starts over: init reseeds `alice` and `bob` and rewrites
`<state>/accounts.env` from scratch, so the logins the tools wrote there are gone along with their
accounts (run `snowglobe account` and `snowglobe invite` again), and the authority is made again with
a new DID.

## What it writes

Everything is kept in `<state>`, the snowglobe's own folder ([above](#which-snowglobe-and-where-it-lives)),
and nothing in the checkout:

- `<state>/devnet.env`: the snowglobe's own facts, nothing secret. `<NAME>_PDS_URL` for each PDS
  (`ALPHA_PDS_URL`, `REGULAR_PDS_URL`, `PROD_PDS_URL` by default; a name starting with a digit gets a
  leading `_`, as in `_1ST_PDS_URL`), `PLC_URL` (`https://plc.directory`), `JETSTREAM_URL` (`ws://127.0.0.1:<port>`),
  `MAILDEV_URL`, `LEX_AUTHORITY_DID`, `LEX_AUTHORITY_HANDLE`, `SG_PROJECT`, `SG_DOMAIN`,
  `PAGE_URL` (`https://local.snowglobe.at/`), `PROXY_PAC_URL` (`http://127.0.0.1:<port>/proxy.pac`) and
  `SG_CA_FILE`.
  An app can source it: `set -a; . <state>/devnet.env; set +a`.
- `<state>/accounts.env` (mode 600): logins. `SG_INVITE_CODE`, `ALICE_*` and `BOB_*` from init,
  `LEX_AUTHORITY_*`, and whatever the [tools for an app](your-app.md#tools-for-an-app) add.
- `<state>/globe/`: the rendered snowglobe, nothing secret. `compose.yml`, `nginx/` (each PDS's and
  group host's server and the page's relays to it), `leaf-names` and `globe.env` (the facts the scripts read).
  `snowglobe up` writes it again on every run; `bin/snowglobe.mjs render` writes it alone.
- `<state>/https/`: `leaf.crt` and `leaf.key` (what nginx serves),
  `names` (the handles `snowglobe run` maps), `apps` and `nginx/` (the app routes and the page's
  `globe.json`), and `hosts` (the
  hosts file `snowglobe run` last generated).
- `<state root>/ca/`: `ca.crt` and `ca.key`, your CA, one for all your snowglobes ([The CA](browser.md#the-ca)).
