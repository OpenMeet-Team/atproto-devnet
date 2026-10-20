// bin/snowglobe.mjs run [--] <cmd> [args...]
//
// run runs a command as if the globe were the real network, for that command's process tree
// only:
//   - the globe's names (its page, each PDS, its services and plc.directory, from the rendered
//     globe), every handle in data/https/names (account and up add them) and every app in
//     data/https/apps, as <name>.devnet.internal, resolve to DEVNET_BIND, where nginx answers on
//     443 (lib/hosts.mjs). HTTPS_RUN_EXTRA_NAMES adds names (space-separated);
//   - Node trusts the globe's CA (NODE_EXTRA_CA_CERTS=data/https/ca.crt), on top of its own
//     roots. Miniflare passes the same file on to workerd.
//
// e.g. bin/snowglobe.mjs run node scripts/https-probe.mjs
//      (cd ../myapp && ../atproto-devnet/bin/snowglobe.mjs run npm run dev)
//
// How: bubblewrap gives the command its own mount namespace with a generated hosts file bound
// over /etc/hosts. Nothing else changes: same filesystem, same network, same user. Outside,
// every name resolves as usual. The names are read when the command starts, so a handle or app
// added later needs a restart of the command. Linux only: a Mac has no bubblewrap, and reaches
// the globe through its proxy (PROXY_PAC_URL in data/devnet.env) instead.

import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { constants as os } from 'node:os';
import { delimiter, join } from 'node:path';
import { readApps } from '../apps.mjs';
import { ROOT, paths, resolveBind, resolveDomain } from '../env.mjs';
import { hostsFile, runNames } from '../hosts.mjs';

export const command = {
  name: 'run',
  usage: 'run [--] <cmd> [args...]',
  // Every word after run is the command's own, dashes and all; none is a usage mistake.
  parse: (args) => {
    const cmd = args[0] === '--' ? args.slice(1) : args;
    return cmd.length ? cmd : null;
  },
};

// The first `name` on PATH that can be run, or null.
function onPath(name, env) {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  return null;
}

export const run = (cmd) => runUnder(cmd);

/** Run `cmd` (a word list) under the globe's names; resolves to its exit code. */
export function runUnder(cmd, { root = ROOT, env = process.env } = {}) {
  if (process.platform !== 'linux')
    throw new Error('run needs Linux (bubblewrap); on this system, point the app at the proxy: PROXY_PAC_URL in data/devnet.env');
  const p = paths(root);
  if (!existsSync(p.ca)) throw new Error(`no ${p.ca}; run bin/snowglobe.mjs up (or certs) first`);
  if (!existsSync(p.leafNames)) throw new Error(`no ${p.leafNames}; run bin/snowglobe.mjs up first`);
  const bwrap = onPath('bwrap', env);
  if (!bwrap) throw new Error('bwrap (bubblewrap) is not installed, or not on PATH');
  // Refuses a DEVNET_DOMAIN the render is not for, and a DEVNET_BIND that is not loopback.
  resolveDomain({ root, env });
  const bind = resolveBind({ root, env });

  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const names = runNames({ leafNames: read(p.leafNames), handles: read(p.names), apps: readApps(p), extra: env.HTTPS_RUN_EXTRA_NAMES });
  // Written aside and renamed, so a run already holding the old file is undisturbed.
  const hosts = join(p.https, 'hosts');
  writeFileSync(`${hosts}.tmp.${process.pid}`, hostsFile(read('/etc/hosts'), names, bind), { mode: 0o644 });
  renameSync(`${hosts}.tmp.${process.pid}`, hosts);

  const child = spawn(bwrap, ['--dev-bind', '/', '/', '--ro-bind', hosts, '/etc/hosts', '--die-with-parent', '--', ...cmd], {
    stdio: 'inherit',
    env: { ...env, NODE_EXTRA_CA_CERTS: p.ca },
  });
  // A terminal's ^C reaches the whole process group, the command included, so it is left to the
  // command; a signal sent to run alone is passed on.
  process.on('SIGINT', () => {});
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('exit', (code, signal) => done(signal ? 128 + (os.signals[signal] ?? 0) : code));
  });
}
