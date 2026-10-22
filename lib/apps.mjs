// Apps on this machine, routed through the https globe's nginx: https://<name>.app.<domain> goes
// to a port here, for an app's pages, its OAuth client metadata and its keys, at an https origin
// the globe's PDSes and snowglobe run's processes both reach. An app that hands out handles of its own,
// as a PDS does, also claims an ending: every name under <ending>.<domain> goes to it, so a handle
// there resolves at the app.
//
// The routes are kept in data/https/apps, "<name> <port> [<ending>]" per line. From them and the
// rendered globe's page facts (data/globe/page.json), nginx's apps.conf and apps.map and the
// network page's globe.json are rendered into data/https/nginx/ (mounted at /etc/nginx/devnet/;
// see https/nginx.conf.template). The renderers are pure; renderRoutes writes what they render, for
// bin/snowglobe.mjs app (lib/commands/app.mjs), which keeps the routes.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, globeFacts, paths } from './env.mjs';

const HEADER = '# Written by bin/snowglobe.mjs app from data/https/apps; rerun it instead of editing.\n';

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
  const map = HEADER + apps.map((a) => `${a.name}.app.${domain} ${upstream(a)};\n`).join('');
  return { 'apps.conf': conf, 'apps.map': map };
}

/** The network page's globe.json: the rendered globe's page facts, with a link to each routed app. */
export function renderPage(page, apps, domain = page.domain) {
  const links = [...(page.apps ?? []), ...apps.map((a) => ({ name: a.name, url: `https://${a.name}.app.${domain}` }))];
  return JSON.stringify({ ...page, apps: links }, null, 2) + '\n';
}

// Written aside and renamed, so nginx never reads half a file.
function put(file, text) {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

/** The routes kept in data/https/apps (`p` from paths()), [] when there are none. */
export const readApps = (p) => (existsSync(p.apps) ? parseApps(readFileSync(p.apps, 'utf8')) : []);

/** Keep `apps` as the routes in data/https/apps. */
export const writeApps = (p, apps) => put(p.apps, formatApps(apps));

/** Render data/https/nginx/ from the routes and the rendered globe. */
export function renderRoutes({ root = ROOT, env = process.env } = {}) {
  const p = paths(root);
  const pageJson = join(p.globe, 'page.json');
  if (!existsSync(pageJson)) throw new Error(`No ${pageJson}: run bin/snowglobe.mjs up, which renders it`);
  const { domain } = globeFacts({ root, env });
  const apps = readApps(p);
  const out = join(p.https, 'nginx');
  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(renderApps(apps, domain))) put(join(out, name), text);
  put(join(out, 'globe.json'), renderPage(JSON.parse(readFileSync(pageJson, 'utf8')), apps));
}
