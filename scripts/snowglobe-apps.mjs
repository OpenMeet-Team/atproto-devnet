// Apps on this machine, routed through the https globe's nginx: https://<name>.devnet.internal goes
// to a port here, for an app's pages, its OAuth client metadata and its keys, at an https origin
// the globe's PDSes and https-run's processes both reach. An app that hands out handles of its own,
// as a PDS does, also claims an ending: every name under <ending>.<domain> goes to it, so a handle
// there resolves at the app.
//
// The routes are kept in data/https/apps, "<name> <port> [<ending>]" per line. From them and the
// rendered globe's page facts (data/globe/page.json), nginx's apps.conf and apps.map and the
// network page's globe.json are rendered into data/https/nginx/ (mounted at /etc/nginx/devnet/;
// see https/nginx.conf.template). The renderers are pure; scripts/snowglobe app writes them.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureCerts, leafLacks, leafNames } from './snowglobe-certs.mjs';
import { ROOT, UsageError, dc, envGet, globeFacts, paths } from './snowglobe-env.mjs';

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const HEADER = '# Written by scripts/snowglobe app from data/https/apps; rerun it instead of editing.\n';

/** The routes in an apps file's text: [{ name, port, ending }], ending null when none. */
export function parseApps(text) {
  return text
    .split('\n')
    .map((l) => l.split(/\s+/).filter(Boolean))
    .filter((f) => f.length >= 2)
    .map(([name, port, ending]) => ({ name, port: Number(port), ending: ending ?? null }));
}

export const formatApps = (apps) => apps.map((a) => `${a.name} ${a.port}${a.ending ? ` ${a.ending}` : ''}\n`).join('');

const upstream = (a) => `devnet_app_${a.name.replace(/-/g, '_')}`;

/**
 * nginx's part for the routes: apps.conf, one upstream per app at host.docker.internal:<port> and,
 * for an app that claimed an ending, a server for *.<ending>.<domain>; apps.map, one line per name.
 */
export function renderApps(apps, domain) {
  const conf =
    HEADER +
    apps.map((a) => `upstream ${upstream(a)} { server host.docker.internal:${a.port}; }\n`).join('') +
    // Host is passed through (the http block sets it), so the app answers
    // /.well-known/atproto-did for each handle. nginx takes the longer of two matching
    // wildcards, so these win over a PDS's *.<domain>.
    apps
      .filter((a) => a.ending)
      .map(
        (a) =>
          `\n# Handles under ${a.ending}.${domain} go to ${a.name}.\nserver {\n    listen 443 ssl;\n    server_name *.${a.ending}.${domain};\n` +
          `    location / {\n        proxy_pass http://${upstream(a)};\n    }\n}\n`,
      )
      .join('');
  const map = HEADER + apps.map((a) => `${a.name}.devnet.internal ${upstream(a)};\n`).join('');
  return { 'apps.conf': conf, 'apps.map': map };
}

/** The network page's globe.json: the rendered globe's page facts, with a link to each routed app. */
export function renderPage(page, apps) {
  const links = [...(page.apps ?? []), ...apps.map((a) => ({ name: a.name, url: `https://${a.name}.devnet.internal` }))];
  return JSON.stringify({ ...page, apps: links }, null, 2) + '\n';
}

// Written aside and renamed, so nginx never reads half a file.
function put(file, text) {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

const readApps = (p) => (existsSync(p.apps) ? parseApps(readFileSync(p.apps, 'utf8')) : []);

/** Render data/https/nginx/ from the routes and the rendered globe. */
export function renderRoutes({ root = ROOT, env = process.env } = {}) {
  const p = paths(root);
  const pageJson = join(p.globe, 'page.json');
  if (!existsSync(pageJson)) throw new Error(`No ${pageJson}: run scripts/https-up.sh, which renders it`);
  const { domain } = globeFacts({ root, env });
  const apps = readApps(p);
  const out = join(p.https, 'nginx');
  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(renderApps(apps, domain))) put(join(out, name), text);
  put(join(out, 'globe.json'), renderPage(JSON.parse(readFileSync(pageJson, 'utf8')), apps));
}

/**
 * Add, change or (remove) drop the route for `name`, issue the leaf if it now lacks a name (an
 * ending's wildcard, from the same CA), render, and reload nginx in the running globe after
 * nginx -t. A globe that is not running keeps the route; https-up.sh loads it.
 */
export async function app({ name, port, ending, remove = false, root = ROOT, env = process.env, log = () => {} }) {
  if (!LABEL_RE.test(name ?? '')) throw new UsageError(`<name> must be one lowercase DNS label: ${name}`);
  const p = paths(root);
  const g = globeFacts({ root, env });
  mkdirSync(p.https, { recursive: true });
  const apps = readApps(p);
  const others = apps.filter((a) => a.name !== name);

  let newLeaf = false;
  if (remove) {
    if (others.length === apps.length)
      throw new Error(`no route named ${name} in data/https/apps; routed: ${apps.map((a) => a.name).join(' ') || 'none'}`);
    put(p.apps, formatApps(others));
    renderRoutes({ root, env });
    // The leaf keeps a removed ending's name; an extra name on a certificate is harmless.
    log(`Removed https://${name}.devnet.internal (data/https/apps)`);
  } else {
    if (!/^[1-9][0-9]{0,4}$/.test(String(port ?? '')) || Number(port) > 65535) throw new UsageError(`<port> must be a port number: ${port}`);
    if (ending) {
      if (!LABEL_RE.test(ending)) throw new UsageError(`<ending> must be one lowercase DNS label: ${ending}`);
      // A PDS's handles are its own, and an ending is one app's.
      if (g.pds.includes(ending)) throw new Error(`${ending}.${g.domain} is the PDS ${ending}'s own`);
      const owner = others.find((a) => a.ending === ending);
      if (owner) throw new Error(`handles under ${ending}.${g.domain} already go to ${owner.name} (data/https/apps)`);
    }
    // A rerun with the same name changes its port, and drops its ending unless given again.
    put(p.apps, formatApps([...others, { name, port: Number(port), ending: ending || null }]));
    const names = leafNames(p, g.domain, env.HTTPS_EXTRA_NAMES);
    if (leafLacks(p.https, names)) ({ newLeaf } = await ensureCerts({ dir: p.https, domain: g.domain, names, log }));
    renderRoutes({ root, env });
    log(`https://${name}.devnet.internal -> port ${port} on this machine (data/https/apps)`);
    if (ending) log(`https://<handle>.${ending}.${g.domain} -> the same port`);
  }

  const project = env.DEVNET_PROJECT || envGet('DEVNET_PROJECT', join(p.data, 'devnet.env'));
  if (!project) return log('No DEVNET_PROJECT and no data/devnet.env; nginx loads the route when https-up.sh starts the globe');
  const running = dc(project, ['ps', '-q', '--status', 'running', 'nginx'], { root, stdio: 'pipe', encoding: 'utf8' });
  if (running.status !== 0 || !running.stdout.trim())
    return log(`nginx is not running in ${project}; it loads the route when https-up.sh starts it`);
  if (dc(project, ['exec', '-T', 'nginx', 'nginx', '-t', '-q'], { root }).status !== 0)
    throw new Error('nginx refused the new routes; data/https/nginx/ holds what it read');
  // A reload rereads the certificate too.
  if (dc(project, ['exec', '-T', 'nginx', 'nginx', '-s', 'reload'], { root }).status !== 0) throw new Error('nginx did not reload');
  log(`Reloaded nginx in ${project}${newLeaf ? ', with the new leaf' : ''}`);
}
