# Your app on a snowglobe

An app uses a snowglobe the way it would use the real network. Three things connect them:

1. A `snowglobe.yml` in the app's repo, next to the lexicons it publishes, says what snowglobe the app
   needs: its PDSes, the accounts the app signs in with, its lexicons and a route to the app
   ([The file and the commands](snowglobe.md#the-file-and-the-commands)). From the snowglobe checkout,
   `bin/snowglobe.mjs up ../myapp/snowglobe.yml` brings that snowglobe up and makes all of it.
2. `snowglobe run` starts the app, or its tests, so that they reach the snowglobe at the real network's
   names and trust the snowglobe's CA (below).
3. `snowglobe env` hands the app the snowglobe's addresses as settings, from the `env:` mapping under
   the app in `snowglobe.yml` (below): `eval "$(snowglobe env)"`. The logins are in
   `<state>/accounts.env`.

The tools further down make what the file does not: more accounts, invite codes, lexicons and
routes.

## Running a command against it: `snowglobe run`

```bash
bin/snowglobe.mjs run getent hosts plc.directory     # 127.0.0.1 inside; the real address outside
(cd ../bookclub && ../snowglobe/bin/snowglobe.mjs run npm run dev)
```

`snowglobe run <cmd>` runs the command with two changes, for its process tree only:

- the snowglobe's names (its page, every PDS, its services and `plc.directory`, as the rendered snowglobe
  lists them), every handle in `<state>/https/names` and every app in `<state>/https/apps` (as
  `<name>.app.<domain>`) resolve to `SG_BIND` (`127.0.0.1` by default).
  [bubblewrap](https://github.com/containers/bubblewrap) gives the command its own mount namespace,
  with a generated hosts file bound over `/etc/hosts`. Same filesystem, network and user otherwise.
  `HTTPS_RUN_EXTRA_NAMES` adds names.
- Node trusts the snowglobe's CA on top of its own roots (`NODE_EXTRA_CA_CERTS=<state root>/ca/ca.crt`).
  Miniflare's source passes the same file to workerd, so a Worker's `fetch` should trust it too.

The names are read when the command starts. Handles are listed one by one (there is no wildcard
DNS), so restart a command under `snowglobe run` to pick up a handle or app made after it started.
Node's certificate checks stay on: `snowglobe run` only adds a CA for them to trust. It needs Linux
and bubblewrap; on a Mac it says so and exits, and an app there is handed its settings with
`eval "$(snowglobe env)"` instead.

## An app's settings: `snowglobe env`

An app is handed the snowglobe's addresses as settings; nothing stands in for Bluesky's names. The
mapping is `apps[].env` in `snowglobe.yml`, from the setting's name to a value that may hold
`${name}` placeholders (`$$` is a literal `$`). Quote a value that starts with `${` inside `{ }`;
in a block map it needs none.

```yaml
apps:
  - name: atmo
    local: { port: 5173 }
    env:
      PUBLIC_ATPROTO_PLC_URL: ${services.plc.url}
      PUBLIC_ATPROTO_JETSTREAM_URLS: ${services.jetstream.ws}
      PUBLIC_ATPROTO_SIGNUP_PDS: ${pds.alpha.url}
      E2E_CREDENTIALS: ${accounts.file}
```

```bash
eval "$(snowglobe env)"               # export NAME='value' lines, and NODE_EXTRA_CA_CERTS
snowglobe env --dotenv > .env.local   # NAME=value, for a framework's own file
snowglobe run npm run dev             # the same settings, passwords included, for that command
```

With one app in the file, `env` and `run` use it; with several, name it with `--app <name>`; with
none, only `NODE_EXTRA_CA_CERTS` is set. `env` leaves out a password
(`accounts.<name>.password`) and prints a comment naming it; `--secrets` includes it, and `run`
always does, printing none. `--dotenv` quotes for dotenv and Vite, and refuses (naming the setting)
a value with a `$` that starts a name, since Vite would expand it; use the `export` form for that one.
A setting `run` hands over replaces the same name already in the environment, and `run` prints one
line naming the ones it replaced.

The names follow the file: the section, the name you gave it, then the field. Every server has
`.url` (`https://<host>`) and `.host`:

| Name | Value |
|---|---|
| `domain`, `globe`, `page.url` | the file's domain and name; `https://<domain>/` |
| `pds.<name>.url` `.host` `.did` | `https://<name>.<domain>`, the host, `did:web:<host>` |
| `grouphosts.<name>.url` `.host` `.did` | the same, for a group host |
| `apps.<name>.url` `.host` | `https://<name>.app.<domain>` |
| `services.plc.url` | `https://plc.<domain>` |
| `services.relay` `.jetstream` `.url` `.ws` | `https://relay.<domain>`, `wss://relay.<domain>`; Jetstream's `.ws` ends in `/subscribe` |
| `services.slingshot.url`, `services.pdsls.url` | `https://slingshot.<domain>`, `https://pdsls.<domain>` |
| `accounts.<name>.handle` `.pds` | the handle, and its PDS's url |
| `lexicons.authority.handle` | the authority account's handle |
| `services.mail.url`, `accounts.<name>.did` `.password`, `accounts.file`, `lexicons.authority.did`, `ca.file` | known after `snowglobe up`, read from its state |

`snowglobe check` reads the names with the rest of the file: a misspelled one is an error at
`apps[0].env.<NAME>` that lists what exists ("pds.nope is not a PDS in this file: alpha, regular,
prod"), and so is the address of a service the file turns off. Account names must be unique in the
file.

## Tools for an app

Each example uses a made-up app, `bookclub`. None of them prints a secret; a login or code goes only
to the file named.

**An account**, on any PDS in the snowglobe: `bin/snowglobe.mjs account <name> <PREFIX> [<pds>]`.

```bash
bin/snowglobe.mjs account bookclubowner BOOKCLUB_OWNER            # bookclubowner.local.snowglobe.at on the alpha
bin/snowglobe.mjs account bookreader BOOKCLUB_READER regular      # bookreader.regular.local.snowglobe.at
```

Without `<pds>` it uses the PDS with `bare_handles`, else the first. It prints the DID alone, and a
rerun finds the account instead of making another. The login goes to `ACCOUNTS_FILE` (default
`<state>/accounts.env`, mode 600) as `<PREFIX>_HANDLE`, `_DID`, `_PASSWORD` and `_PDS`, and the
handle goes to `<state>/https/names`. A PDS with `invites: required` is sent `SG_INVITE_CODE` if it
is set, else a single-use code minted for the account; the others are sent none. On the PDS with
bare handles, a name the snowglobe uses itself (a PDS's, a service's, an app's handle ending) is
refused, because the handle would be that name.

**An invite code**, for an app that creates accounts itself:
`bin/snowglobe.mjs invite <VAR> [file] [--pds <pds>]`.

```bash
bin/snowglobe.mjs invite BOOKCLUB_INVITE_CODE ../bookclub/.env.snowglobe
```

It mints the code through the PDS's admin API (`INVITE_USES`, default 100) and writes
`<VAR>=<code>` to the file (default `<state>/accounts.env`, mode 600), replacing an earlier line. The
PDS is the one with `invites: required`; name it with `--pds` when the snowglobe has more than one.

**Lexicons.** With `PDS_LEXICON_AUTHORITY_DID` set, every PDS in the snowglobe resolves **every** NSID from
the authority account, never from DNS, so an app's record types, permission sets and space types
have to be published there as `com.atproto.lexicon.schema` records, keyed by NSID. An app publishes
its own:

```bash
bin/snowglobe.mjs lexicons ../bookclub/lexicons    # prints each NSID: com.example.bookclub.review, ...
```

It publishes every lexicon JSON under the folder, at any depth, and leaves a record alone when it
already holds the same document. Or publish with the app's own tooling: sign in with the
`LEX_AUTHORITY_*` login in `<state>/accounts.env` and `putRecord` each document into
`com.atproto.lexicon.schema` with the NSID as the record key.

**An app route**, so the app has an https origin that both the PDSes and `snowglobe run`'s processes
reach: `bin/snowglobe.mjs app <name> <port>`.

```bash
bin/snowglobe.mjs app bookclub 5600     # https://bookclub.app.local.snowglobe.at -> port 5600 on this machine
```

The app must listen where Docker's host gateway lands (`host.docker.internal` inside the
containers; the `docker0` address here), or on `0.0.0.0`. The route is kept in `<state>/https/apps` (a
rerun with the same name changes the port), and nginx in the snowglobe's stack is reloaded.
`bin/snowglobe.mjs app --remove bookclub` drops the route the same way, and the app comes off the
network page. `bin/snowglobe.mjs app --render` only writes nginx's routes and the network page from
`<state>/https/apps`, as `snowglobe up` does before it starts the snowglobe. A name under `app.<domain>` with no route gets a 404 from nginx and reaches nothing. A confidential
OAuth client can use `https://bookclub.app.local.snowglobe.at/...` as its client_id: the PDS fetches its
metadata and keys from there over TLS. A client_id under `.test` is refused by the PDS
(`invalid_client_id: The client_id's TLD must not be a local hostname`), which is why apps live under
`app.<domain>`, a name that is not local.

**A handle ending**, for an app that hands out handles of its own, as a PDS does. A third word
claims one:

```bash
bin/snowglobe.mjs app grouphost 7070 gh  # also https://<handle>.gh.local.snowglobe.at -> port 7070
```

nginx then sends every name under `gh.local.snowglobe.at` to the app, Host and all, so the app answers
`/.well-known/atproto-did` for its handles and they resolve from anywhere on the snowglobe. The leaf
gains `*.gh.local.snowglobe.at` from the same CA, so nothing has to be trusted again. `alpha`, `regular` and
`prod` belong to the PDSes, and an ending belongs to one app. A rerun without the ending drops it.
Under `snowglobe run`, list each such handle in `HTTPS_RUN_EXTRA_NAMES`, as for any handle.

`scripts/https-probe.mjs` checks the whole path for any app name. It resolves an account through
`https://plc.directory` with stock atcute at its defaults, serves a confidential client at
`https://<PROBE_APP>.app.<domain>/`, pushes a PAR with that client_id, and pushes a raw PAR with a
`.test` client_id, which the PDS refuses. `ATCUTE_DIR` is required: a directory node resolves
`@atcute/oauth-node-client` and `@atcute/identity-resolver` from.

```bash
bin/snowglobe.mjs app probe 5480
ATCUTE_DIR=<dir> PROBE_DID=<did> bin/snowglobe.mjs run node scripts/https-probe.mjs
```

```
RESOLVED did:plc:... on https://alpha.local.snowglobe.at through plc.directory, ... off
PAR ACCEPTED for confidential client https://probe.app.local.snowglobe.at/probe-<run>/oauth-client-metadata.json
REFUSED .test client_id: HTTP 400 invalid_client_id: The client_id's TLD must not be a local hostname
```
