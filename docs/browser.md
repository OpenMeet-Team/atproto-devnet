# From a browser on your own computer

nginx runs in the dev container, so a browser on your own computer needs two things: a way to send
the devnet's names to it, and trust in the devnet's CA. The proxy below does the first with a
setting you make once, in the browser you already use. Launch flags (further down) are the older way.

## Through the devnet's proxy (Chrome, Edge, Firefox)

The `proxy` service (`https/proxy/server.mjs`) is a proxy and the PAC file that points at it, on one
port, `127.0.0.1:1080` (`SG_PROXY_PORT`). The PAC names it as an HTTP proxy, which every PAC
reader understands, Windows' own included; it also answers SOCKS5, for a client set to it directly. The PAC sends `local.snowglobe.at`, `*.local.snowglobe.at` and
`*.devnet.internal` to the proxy and everything else direct, so the rest of your browsing is
untouched. The browser hands the proxy the name, and the proxy connects every devnet name to nginx,
so a handle made a second ago works with nothing to update. It refuses any other name, any IP
address and any port but 443.

**Once per computer:**

1. **Trust the devnet's CA** (more in [The CA](#the-ca)). Copy `data/https/ca.crt` from the devnet
   checkout to your computer, then:
   - Windows, for Chrome, Edge and Firefox: `certutil -user -addstore Root ca.crt` (no admin; Windows
     asks you to confirm). Firefox reads the Windows store: a Firefox on Windows set up this way
     found the trusted CA on 2026-10-19.
   - macOS, for Chrome, Edge and Safari:
     `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ca.crt`.
     Firefox: Settings, Privacy & Security, View Certificates, Authorities, Import.
   - Linux: Chrome and Edge read `~/.pki/nssdb`:
     `certutil -d sql:$HOME/.pki/nssdb -A -t C,, -n atproto-devnet -i ca.crt` (from `libnss3-tools`).
     Firefox: import it as on macOS.

   Without this step the proxy still works, but each devnet name gets a certificate warning you click
   through once, and an app's own calls from the page to a PDS fail where no one can click.
2. **Forward the proxy's port.** In VS Code's Ports view, forward port 1080 of the dev container
   (`SG_PROXY_PORT`, if you set one). Any local port will do: the PAC names the address it was
   fetched from. The proxy asks no one to sign in, so whoever can reach the forwarded port reaches
   the whole devnet: every PDS, the PLC, the network page, and every app of yours routed with
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
`https://atmo.devnet.internal` once atmo is routed (below).

**When you are done**, turn the setting off, or leave it: it sends only devnet names anywhere, and
those fail anyway while the devnet is down. What a browser does when it cannot fetch the PAC itself
was not measured.

`proxy.pac` leaves `plc.directory` alone, so the setting never moves the real directory for your
everyday browsing; apps on the devnet use `https://plc.local.snowglobe.at`. For an app that insists on
`plc.directory` in the browser, a profile used only for the devnet can take
`http://127.0.0.1:1080/proxy-with-plc.pac`, where it is this devnet's PLC.

Measured on 2026-10-19, on Windows: Chrome through the Windows "Use setup script" setting (the PAC
then named a SOCKS5 proxy), and Firefox both through its own "Automatic proxy configuration URL" and
through "Use system proxy settings" (an HTTP proxy), reached the page and a handle's own name. Firefox
uses the Windows setting only when its Network Settings say "Use system proxy settings": with any other
choice it fetches no PAC and the devnet's names do not resolve. In the dev
container, full Chromium and Firefox set only to the PAC URL went from the page to atmo and signed in
through the alpha's sign-in and consent pages, asking no host outside the devnet, with either kind
of proxy. Not measured: Edge, macOS, Linux desktops. Playwright's default headless shell ignores
`--proxy-pac-url`; real Chrome and Edge are the full build.

## With launch flags (Chrome, Edge)

1. **Forward port 443**, in VS Code's Ports view: container 443 to host **443** exactly. The PDS's
   URLs carry no port, and VS Code quietly picks another local port when 443 is taken, so check the
   forwarded address. Forward your app's own port too if the browser opens it directly.
2. **Map the names to `127.0.0.1` for the browser.** Start a separate Chrome or Edge instance with
   its own profile directory, so the flag takes effect even when the browser is already open:

   ```
   rem cmd.exe; in PowerShell, write $env:TEMP for %TEMP%
   chrome.exe --user-data-dir=%TEMP%\devnet-https --host-resolver-rules="MAP local.snowglobe.at 127.0.0.1, MAP *.local.snowglobe.at 127.0.0.1, MAP plc.directory 127.0.0.1, MAP *.devnet.internal 127.0.0.1"
   ```

   The wildcard rule covers the PDS names and the handles; the bare `local.snowglobe.at`, the network's
   page, needs its own. Hosts-file entries work too, one name at a time; they need admin, and they
   point `plc.directory` at the devnet for every program on the computer until you remove the line.
3. **Trust the CA**, as in step 1 of the proxy's steps.

## The CA

`bin/snowglobe.mjs certs` makes the CA once, in Node (no openssl needed). `snowglobe up` runs it
when there is no leaf, or when the leaf lacks a name. Rerunning it keeps the CA and reissues the
leaf only when it lacks a name, so a browser or OS that trusts `ca.crt` keeps trusting the devnet.
A CA made by the old `scripts/https-ca.sh` is kept the same way. `bin/snowglobe.mjs certs --check`
only says whether the leaf lacks a name (exit 1) or not (exit 0). The leaf names what the render lists in
`data/globe/leaf-names`: `local.snowglobe.at` itself, each PDS and its handles (`*.local.snowglobe.at` for the one
with bare handles, `*.<name>.local.snowglobe.at` for each other), each group host and its groups' handles,
`plc.`, `relay.`, `jetstream.`,
`slingshot.` and `pdsls.local.snowglobe.at`, `plc.directory` and `*.devnet.internal`; and
`*.<ending>.local.snowglobe.at` for each handle ending an app claimed. A TLS wildcard covers one label, so
each handle domain needs its own. `snowglobe app` reissues the leaf
when it claims an ending, and `snowglobe up` when the leaf lacks any of these names. Add deeper names
with `HTTPS_EXTRA_NAMES="x.mine.local.snowglobe.at"` on every run, then restart nginx. A name one label
under `local.snowglobe.at` is already covered. To start over, delete `data/https/ca.*` and trust the new
`ca.crt` wherever the old one was trusted.

The CA can only vouch for servers under `local.snowglobe.at` (the `SG_DOMAIN` it was made for),
`devnet.internal` and `plc.directory` (name constraints, server auth only, no IP addresses), so trusting it puts no other site at risk, even if
`data/https/ca.key` leaks. Keep that file on the dev machine, and remove the CA from a browser or OS
when you're done with it. On Windows: `certutil -user -delstore Root "<its name>"`, the name being the
CN that `bin/snowglobe.mjs certs` prints ("Keeping the existing CA: ...").

Each CA made since 2026-10-19 has a name of its own, `atproto-devnet local CA <date> <hex>`; older
ones are all `atproto-devnet local CA`. Two CAs with one name break each other: a browser that trusts
one checks the other's certificates against the wrong key and rejects them as a bad signature, which
it will not let you click through. So a second checkout's devnet, with a CA of its own, gets an
ordinary unknown-issuer warning instead, until its CA is trusted too.
