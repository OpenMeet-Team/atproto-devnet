# From a browser on your own computer

A browser needs two things to open a snowglobe: the snowglobe's names have to reach nginx, and the
browser has to trust the snowglobe's CA. What you do about the first depends on where Docker runs.

## Docker on the same computer as the browser

1. **Trust the CA.** Run `bin/snowglobe.mjs trust`. It puts your CA (`<state root>/ca/ca.crt`, one
   per user) in the system store and in the databases Chrome, Edge and Firefox read on Linux, in the
   login keychain on macOS (not tried on a Mac) or in the user store on Windows. It prints every
   command, marks the ones that need sudo, and does nothing the second time. On WSL it also prints
   the PowerShell step for the Windows store, which a Windows browser needs. `trust --dry-run` shows
   what it would do, and `trust --remove` undoes it.
2. **Open `https://local.snowglobe.at/`**, the network's page. Its apps link to themselves, for
   instance `https://atmo.app.local.snowglobe.at` once atmo is routed
   ([Example: atmo](examples/atmo.md)).

That is all. Public DNS answers every name under `local.snowglobe.at` with `127.0.0.1` (checked on
2026-10-22 for `local.`, `alpha.`, an unused name and an app name), and nginx publishes port 443 on
`127.0.0.1`, so there is no proxy to set up and nothing to map. Two cases break that:

- `SG_BIND` set to another loopback address (see [Configuration](configuration.md)): the name still
  resolves to `127.0.0.1`, where nothing listens. Use a hosts-file entry for each name, or the proxy
  below.
- A resolver that drops answers pointing at your own machine, as some routers do (see
  [When the browser cannot open it](#when-the-browser-cannot-open-it)). If a name does not resolve,
  use the proxy below.

`plc.directory` is not under that domain, so a browser still reaches the real directory. Apps on the
snowglobe use `https://plc.local.snowglobe.at`.

## When the browser cannot open it

Measured on 2026-10-22, on Linux with Docker and Firefox and Chrome on the same computer, the
snowglobe up and healthy. Check first that the snowglobe answers, then that the name resolves:

```sh
curl -sk --resolve local.snowglobe.at:443:127.0.0.1 -o /dev/null -w '%{http_code}\n' https://local.snowglobe.at/   # 200
getent hosts local.snowglobe.at                                                                                  # 127.0.0.1
dig +short @1.1.1.1 local.snowglobe.at                                                                           # 127.0.0.1
```

If the first prints 200 and the second prints nothing, the snowglobe is fine and name resolution is
the problem.

- **The router refuses the name (Firefox: "server not found", `getent` prints nothing).** The
  names are public DNS records that point at `127.0.0.1`. A router that does DNS-rebind protection
  drops such answers and replies SERVFAIL, for every name under `snowglobe.at` alike, while
  `1.1.1.1` and `8.8.8.8` answer correctly (`dig @<router> local.snowglobe.at` shows
  `status: SERVFAIL`). Any one of these fixes it:
  - put public resolvers ahead of the router's for your connection (on a NetworkManager system, set
    the connection's DNS servers to `1.1.1.1 8.8.8.8`), which fixes every program;
  - allow `snowglobe.at` in the router's rebind-protection list (dnsmasq: `rebind-domain-ok=/snowglobe.at/`);
  - turn on DNS over HTTPS in the browser (Firefox: Settings, Privacy & Security, DNS over HTTPS),
    which fixes that browser only;
  - or use the proxy below, which resolves the names itself.

  A hosts-file entry works but names every host by hand: `/etc/hosts` has no wildcards, so each
  PDS, handle and app name needs a line.
- **Chrome says `ERR_CONNECTION_REFUSED` for a bare `local.snowglobe.at`.** Typed without a scheme,
  Chrome tries https and, when that fails, falls back to `http://`, which is port 80. A snowglobe
  publishes only 443, so the fallback is refused and hides the https failure behind it. Type
  `https://local.snowglobe.at/` in full. If it then fails, the error shown is the real one. In our
  run it opened at once once the name resolved; flush Chrome's lookups with
  `chrome://net-internals/#dns` ("Clear host cache") and `chrome://net-internals/#sockets` ("Flush
  socket pools") when it still shows the old failure. Likely cause, not isolated: the earlier DNS
  failure.
- **A certificate warning, or a failure no click gets past.** The browser does not trust the CA. Run
  `bin/snowglobe.mjs trust` and see [The CA](#the-ca). Firefox keeps its own store unless `trust`
  has put the CA in it.

## Docker somewhere else: a dev container or another machine

nginx runs where Docker runs, so a browser on a different computer needs a way to send the
snowglobe's names to it, as well as trust in the CA. The proxy below does the first with a setting
you make once, in the browser you already use. Launch flags (further down) are the older way.

### Through the snowglobe's proxy (Chrome, Edge, Firefox)

The `proxy` service (`https/proxy/server.mjs`) is a proxy and the PAC file that points at it, on one
port, `127.0.0.1:1080` (`SG_PROXY_PORT`). The PAC names it as an HTTP proxy, which every PAC
reader understands, Windows' own included; it also answers SOCKS5, for a client set to it directly. The PAC sends `local.snowglobe.at` and `*.local.snowglobe.at` (apps included) to the proxy and
everything else direct, so the rest of your browsing is untouched. The browser hands the proxy the name, and the proxy connects every name in the snowglobe to nginx,
so a handle made a second ago works with nothing to update. It refuses any other name, any IP
address and any port but 443.

**Once per computer:**

1. **Trust the snowglobe's CA** (more in [The CA](#the-ca)). On the machine whose browser you use, if
   Docker runs there too, `bin/snowglobe.mjs trust` does it (above).

   Otherwise copy `ca.crt` from the machine that runs the snowglobe and trust it by hand:
   - Windows, for Chrome, Edge and Firefox: `certutil -user -addstore Root ca.crt` (no admin; Windows
     asks you to confirm). Firefox reads the Windows store: a Firefox on Windows set up this way
     found the trusted CA on 2026-10-19.
   - macOS, for Chrome, Edge and Safari:
     `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ca.crt`.
     Firefox: Settings, Privacy & Security, View Certificates, Authorities, Import.
   - Linux: Chrome and Edge read `~/.pki/nssdb`:
     `certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n snowglobe -i ca.crt` (from `libnss3-tools`).
     Firefox: import it as on macOS.

   Without this step the proxy still works, but each of the snowglobe's names gets a certificate warning you click
   through once, and an app's own calls from the page to a PDS fail where no one can click.
2. **Forward the proxy's port.** In VS Code's Ports view, forward port 1080 of the dev container
   (`SG_PROXY_PORT`, if you set one). Any local port will do: the PAC names the address it was
   fetched from. The proxy asks no one to sign in, so whoever can reach the forwarded port reaches
   the whole snowglobe: every PDS, the PLC, the network page, and every app of yours routed with
   `snowglobe app`, each behind only its own sign-in. Keep the forwarded port on your computer's
   loopback address and don't open it to a network.
3. **Point the browser at the PAC**, `http://127.0.0.1:1080/proxy.pac` (the forwarded port):
   - Windows, for Chrome, Edge and Firefox: Settings, Network & internet, Proxy, "Use setup script",
     with the URL as the script address.
   - macOS: System Settings, Network, your connection, Details, Proxies, "Automatic proxy
     configuration", with the URL.
   - Linux (GNOME): Settings, Network, Network Proxy, Automatic, with the URL.
   - Firefox: Settings, Network Settings, "Use system proxy settings" (the default, but check it:
     any other choice ignores the Windows setting). Or, for Firefox alone, "Automatic proxy
     configuration URL" with the same URL. Both browsers pick up a change to the Windows setting on
     the next page load; no restart.

**Then** open `https://local.snowglobe.at/`, the network's page. Its apps link to themselves, for instance
`https://atmo.app.local.snowglobe.at` once atmo is routed ([Example: atmo](examples/atmo.md)).

**When you are done**, turn the setting off, or leave it: it sends only the snowglobe's names anywhere, and
those fail anyway while the snowglobe is down. What a browser does when it cannot fetch the PAC itself
was not measured.

`proxy.pac` leaves `plc.directory` alone, so the setting never moves the real directory for your
everyday browsing; apps on the snowglobe use `https://plc.local.snowglobe.at`. For an app that insists on
`plc.directory` in the browser, a profile used only for the snowglobe can take
`http://127.0.0.1:1080/proxy-with-plc.pac`, where it is this snowglobe's PLC.

Measured on 2026-10-19, on Windows: Chrome through the Windows "Use setup script" setting (the PAC
then named a SOCKS5 proxy), and Firefox both through its own "Automatic proxy configuration URL" and
through "Use system proxy settings" (an HTTP proxy), reached the page and a handle's own name. Firefox
uses the Windows setting only when its Network Settings say "Use system proxy settings": with any other
choice it fetches no PAC and the snowglobe's names do not resolve. In the dev
container, full Chromium and Firefox set only to the PAC URL went from the page to atmo and signed in
through the alpha's sign-in and consent pages, asking no host outside the snowglobe, with either kind
of proxy. Not measured: Edge, macOS, Linux desktops. Playwright's default headless shell ignores
`--proxy-pac-url`; real Chrome and Edge are the full build.

### With launch flags (Chrome, Edge)

1. **Forward port 443**, in VS Code's Ports view: container 443 to host **443** exactly. The PDS's
   URLs carry no port, and VS Code quietly picks another local port when 443 is taken, so check the
   forwarded address. Forward your app's own port too if the browser opens it directly.
2. **Map the names to `127.0.0.1` for the browser.** Start a separate Chrome or Edge instance with
   its own profile directory, so the flag takes effect even when the browser is already open:

   ```
   rem cmd.exe; in PowerShell, write $env:TEMP for %TEMP%
   chrome.exe --user-data-dir=%TEMP%\snowglobe-https --host-resolver-rules="MAP local.snowglobe.at 127.0.0.1, MAP *.local.snowglobe.at 127.0.0.1, MAP plc.directory 127.0.0.1"
   ```

   The wildcard rule covers the PDS names and the handles; the bare `local.snowglobe.at`, the network's
   page, needs its own. Hosts-file entries work too, one name at a time; they need admin, and they
   point `plc.directory` at the snowglobe for every program on the computer until you remove the line.
3. **Trust the CA**, as in step 1 of the proxy's steps.

## The CA

`bin/snowglobe.mjs certs` makes the CA once, in Node (no openssl needed). `snowglobe up` runs it
when there is no leaf, or when the leaf lacks a name. Rerunning it keeps the CA and reissues the
leaf only when it lacks a name, so a browser or OS that trusts `ca.crt` keeps trusting every snowglobe you run.
`bin/snowglobe.mjs certs --check`
only says whether the leaf lacks a name (exit 1) or not (exit 0). The leaf names what the render lists in
`<state>/globe/leaf-names`: `local.snowglobe.at` itself, each PDS and its handles (`*.local.snowglobe.at` for the one
with bare handles, `*.<name>.local.snowglobe.at` for each other), each group host and its groups' handles,
`plc.`, `relay.`, `jetstream.`,
`slingshot.` and `pdsls.local.snowglobe.at`, `plc.directory` and `*.app.local.snowglobe.at` (the apps); and
`*.<ending>.local.snowglobe.at` for each handle ending an app claimed. A TLS wildcard covers one label, so
each handle domain needs its own. `snowglobe app` reissues the leaf
when it claims an ending, and `snowglobe up` when the leaf lacks any of these names. Add deeper names
with `HTTPS_EXTRA_NAMES="x.mine.local.snowglobe.at"` on every run, then restart nginx. A name one label
under `local.snowglobe.at` is already covered. To start over, delete `<state>/https/ca.*` and trust the new
`ca.crt` wherever the old one was trusted.

The CA can only vouch for servers under `local.snowglobe.at` (the `SG_DOMAIN` it was made for),
and `plc.directory` (name constraints, server auth only, no IP addresses), so trusting it puts no other site at risk, even if
`<state>/https/ca.key` leaks. Keep that file on the dev machine, and remove the CA from a browser or OS
when you're done with it: `bin/snowglobe.mjs trust --remove`. On Windows by hand:
`certutil -user -delstore Root "<its name>"`, the name being the CN that `bin/snowglobe.mjs certs`
prints ("Keeping the existing CA: ...").

There is one CA per user, shared by all your snowglobes, so you trust it once. Each CA has a name of
its own, `snowglobe local CA <date> <hex>`. Two CAs with one name break each other: a browser that
trusts one checks the other's certificates against the wrong key and rejects them as a bad
signature, which it will not let you click through. Delete the CA's `ca.*` and run `up` again only
when you mean to start over, and remove the old one from the stores (`trust --remove` first).
