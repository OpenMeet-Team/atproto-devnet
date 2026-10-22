// bin/snowglobe.mjs app <name> <port> [<ending>] | --remove <name> | --render
//
// app routes https://<name>.app.<domain> to <port> on this machine through the globe's nginx
// (lib/apps.mjs), and with <ending> every name under <ending>.<domain> too, for an app that hands
// out handles; the leaf gains that wildcard from the same CA. Kept in https/apps in the
// snowglobe's state folder (a rerun changes the port, and drops the ending unless given again);
// nginx's routes and the network page are rendered from it, and nginx reloads after nginx -t if
// the globe runs (its compose project, see lib/state.mjs). --remove drops a route; --render only
// renders, as snowglobe up does before starting the globe.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readApps, renderRoutes, writeApps } from '../apps.mjs';
import { ROOT, UsageError, dc, globeFacts, paths } from '../env.mjs';
import { session } from '../state.mjs';

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const command = {
  name: 'app',
  usage: 'app <name> <port> [<ending>] | --remove <name> | --render',
  options: { remove: { type: 'string' }, render: { type: 'boolean' } },
  positionals: [0, 3],
  // --render alone, --remove <name> alone, or a route (<name> <port> [<ending>]) and no option.
  accepts: ({ positionals, tokens }) => (tokens.some((t) => t.kind === 'option') ? tokens.length === 1 : positionals.length >= 2),
};

export async function run({ values, positionals: [name, port, ending] }) {
  const log = (m) => console.error(m);
  const found = session();
  if (values.render) renderRoutes({ state: found.state });
  else if (values.remove !== undefined) await app({ name: values.remove, remove: true, state: found.state, project: found.project, log });
  else await app({ name, port, ending, state: found.state, project: found.project, log });
}

/**
 * Add, change or (remove) drop the route for `name`, issue the leaf if it now lacks a name (an
 * ending's wildcard, from the same CA), render, and reload nginx in the running globe after
 * nginx -t. A globe that is not running keeps the route; snowglobe up loads it.
 */
export async function app({ name, port, ending, remove = false, root = ROOT, state, project, env = process.env, log = () => {} }) {
  if (!LABEL_RE.test(name ?? '')) throw new UsageError(`<name> must be one lowercase DNS label: ${name}`);
  const p = paths(root, state);
  const g = globeFacts({ root, state, env });
  mkdirSync(p.https, { recursive: true });
  const apps = readApps(p);
  const others = apps.filter((a) => a.name !== name);

  let newLeaf = false;
  if (remove) {
    if (others.length === apps.length)
      throw new Error(`no route named ${name} in ${p.apps}; routed: ${apps.map((a) => a.name).join(' ') || 'none'}`);
    writeApps(p, others);
    renderRoutes({ root, state, env });
    // The leaf keeps a removed ending's name; an extra name on a certificate is harmless.
    log(`Removed https://${name}.app.${g.domain} (${p.apps})`);
  } else {
    if (!/^[1-9][0-9]{0,4}$/.test(String(port ?? '')) || Number(port) > 65535) throw new UsageError(`<port> must be a port number: ${port}`);
    if (ending) {
      if (!LABEL_RE.test(ending)) throw new UsageError(`<ending> must be one lowercase DNS label: ${ending}`);
      if (ending === 'app') throw new UsageError(`<ending> app is where the apps are: ${name}.app.${g.domain}`);
      // A PDS's handles are its own, and an ending is one app's.
      if (g.pds.includes(ending)) throw new Error(`${ending}.${g.domain} is the PDS ${ending}'s own`);
      const owner = others.find((a) => a.ending === ending);
      if (owner) throw new Error(`handles under ${ending}.${g.domain} already go to ${owner.name} (${p.apps})`);
    }
    // A rerun with the same name changes its port, and drops its ending unless given again.
    writeApps(p, [...others, { name, port: Number(port), ending: ending || null }]);
    // Loaded here, so the usage, which loads every command, does without the certificate library.
    const { ensureCerts, leafLacks, leafNames } = await import('../certs.mjs');
    const names = leafNames(p, g.domain, env.HTTPS_EXTRA_NAMES);
    if (leafLacks(p.https, names, p.caDir)) ({ newLeaf } = await ensureCerts({ dir: p.https, caDir: p.caDir, domain: g.domain, names, log }));
    renderRoutes({ root, state, env });
    log(`https://${name}.app.${g.domain} -> port ${port} on this machine (${p.apps})`);
    if (ending) log(`https://<handle>.${ending}.${g.domain} -> the same port`);
  }

  const running = dc(project, ['ps', '-q', '--status', 'running', 'nginx'], { root, state, stdio: 'pipe', encoding: 'utf8' });
  if (running.status !== 0 || !running.stdout.trim())
    return log(`nginx is not running in ${project}; it loads the route when snowglobe up starts it`);
  if (dc(project, ['exec', '-T', 'nginx', 'nginx', '-t', '-q'], { root, state }).status !== 0)
    throw new Error(`nginx refused the new routes; ${join(p.https, 'nginx')} holds what it read`);
  // A reload rereads the certificate too.
  if (dc(project, ['exec', '-T', 'nginx', 'nginx', '-s', 'reload'], { root, state }).status !== 0) throw new Error('nginx did not reload');
  log(`Reloaded nginx in ${project}${newLeaf ? ', with the new leaf' : ''}`);
}
