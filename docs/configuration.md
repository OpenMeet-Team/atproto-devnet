# Configuration

Set these in the environment. `SG_DOMAIN`, `SG_BIND` and the ports can also go in a `.env` file in
the snowglobe checkout. Every setting has a default.

## Snowglobe settings

| Variable | Default | Description |
| --- | --- | --- |
| `SG_PROJECT` | the file's `globe:` name | The snowglobe's Docker Compose project name ([Up and down](snowglobe.md#up-and-down)) |
| `SG_FILE` | none | The `snowglobe.yml` a command reads when no file is named. Without it, the nearest `snowglobe.yml` in the folder you run from or above ([Which snowglobe](snowglobe.md#which-snowglobe-and-where-it-lives)) |
| `XDG_DATA_HOME` | unset | Where snowglobes keep their state, in `snowglobe/` under it. Without it, `~/.local/share/snowglobe` (`%LOCALAPPDATA%\snowglobe` on Windows) |
| `SG_DOMAIN` | `local.snowglobe.at` | The domain every name in the snowglobe sits under, in place of the file's `domain` ([The snowglobe](snowglobe.md)) |
| `SG_BIND` | `127.0.0.1` | The loopback address nginx listens on, port 443. A second snowglobe on the same machine takes another, such as `127.0.0.2` |
| `SG_PLC_PORT` | `2582` | The PLC, on `127.0.0.1` |
| `SG_JETSTREAM_PORT` / `SG_JETSTREAM_METRICS_PORT` | `6008` / `6009` | Jetstream and its metrics, on `127.0.0.1` |
| `SG_MAILDEV_WEB_PORT` / `SG_MAILDEV_SMTP_PORT` | `1081` / `1026` | MailDev, on `127.0.0.1` |
| `SG_PROXY_PORT` | `1080` | The browser proxy and its PAC file, on `127.0.0.1` ([From a browser on your own computer](browser.md)) |
| `SG_OPENSOCIAL_BUILD` | none | A checkout of atproto-group-host, for a group host the file lists with no `build` or `image` |
| `SG_PDS_ADMIN_PASSWORD` | `devnet-admin-password` | Every PDS's admin password. `invite` uses it to mint codes |
| `SG_RELAY_INDIGO_COMMIT` | `b2619d8...` | The indigo commit the relay image is built from ([The relay, built locally](how-it-works.md#the-relay-built-locally)) |
| `SG_SLINGSHOT_COMMIT` | `3137b07...` | The microcosm-rs commit Slingshot is built from ([Slingshot](how-it-works.md#slingshot-handles-and-dids-inside-the-network)) |
| `SG_RESET_OK` | unset | `1` lets `up` and `down` act on the shared project `devnet-spaces` |

To run a second snowglobe beside another, give it a file with its own `globe:` name, and its own `SG_BIND` and ports, and pass
the same values on every run.

## Variables the tools read

| Variable | Default | Description |
| --- | --- | --- |
| `ACCOUNTS_FILE` | `<state>/accounts.env` | Where `account` writes the logins it makes, and where `lexicons` finds the authority's login |
| `INVITE_USES` | `100` | How many uses `invite` gives a code |
| `HTTPS_RUN_EXTRA_NAMES` | none | Names, space-separated, that `snowglobe run` also maps to the snowglobe, such as a group's handle ([Running a command against it](your-app.md#running-a-command-against-it-snowglobe-run)) |
| `HTTPS_EXTRA_NAMES` | none | Names, space-separated, added to the certificate nginx serves, for a name more than one label under the domain ([The CA](browser.md#the-ca)) |

The snowglobe also writes facts for its own commands into `<state>/globe/globe.env` (`SG_PDS`,
`SG_SERVICES` and others) and sets a few names inside its containers. They are not settings.
`SG_PUBLIC=1` points `lexicons` at a hosted snowglobe, for the people who run one.

## The quick stack

The quick stack's settings are in [The quick stack](quick-stack.md#configuration).
