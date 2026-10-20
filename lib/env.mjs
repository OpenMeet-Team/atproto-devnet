// What every snowglobe subcommand shares: where the files are, the domain and the address the
// globe is under (read as compose reads them), env files that hold logins, docker compose on the
// rendered globe, and https to a globe's names. Nothing here prints a secret.
//
// It replaces scripts/https-lib.sh piece by piece: until the last https-* script is ported, both
// read the same files the same way.

import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A mistake in how a command was called, as opposed to one the globe answered with.
export class UsageError extends Error {}

// The repo root, which is also the compose project directory, where compose reads .env.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The files a globe keeps under <root>/data. data/ is git-ignored.
export function paths(root = ROOT) {
  const data = join(root, 'data');
  const https = join(data, 'https');
  const globe = join(data, 'globe');
  return {
    root,
    data,
    https,
    // The devnet's CA, which https-run's processes and devnetRequest trust.
    ca: join(https, 'ca.crt'),
    // The devnet's own logins: the base init's alice, bob and invite code, the lexicon
    // authority, and accounts made by snowglobe account.
    accounts: join(data, 'accounts.env'),
    // App routes, "<name> <port> [<ending>]" per line (snowglobe app).
    apps: join(https, 'apps'),
    // Handles https-run maps to nginx, one per line (snowglobe account, https-up.sh).
    names: join(https, 'names'),
    // The rendered globe (bin/snowglobe.mjs render). Nothing in it is secret.
    globe,
    globeEnv: join(globe, 'globe.env'),
    leafNames: join(globe, 'leaf-names'),
    compose: join(globe, 'compose.yml'),
    dotenv: join(root, '.env'),
  };
}

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []);

// The last value of NAME in an env file the scripts write (NAME=value, nothing else), or ''.
export function envGet(name, file) {
  let value = '';
  for (const l of lines(file)) if (l.startsWith(`${name}=`)) value = l.slice(name.length + 1);
  return value;
}

// NAME's last value in an env file read as compose reads it: an export prefix, spaces around
// the =, quotes, a trailing " # comment" and a CRLF line end are allowed. undefined when the
// file does not set it.
export function envCompose(name, file) {
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  let raw;
  for (const l of lines(file)) {
    const m = l.replace(/\r$/, '').match(re);
    if (m) raw = m[1];
  }
  if (raw === undefined) return undefined;
  const quoted = raw.match(/^"([^"]*)"/) ?? raw.match(/^'([^']*)'/);
  if (quoted) return quoted[1];
  return raw.replace(/\s+#.*/, '').replace(/\s+$/, '');
}

// A setting from the environment, where set (even empty, which then wins), else from .env, as
// compose reads it; '' when neither sets it.
export function setting(name, { root = ROOT, env = process.env } = {}) {
  return env[name] !== undefined ? env[name] : (envCompose(name, paths(root).dotenv) ?? '');
}

// The domain every globe name sits under: DEVNET_DOMAIN from the environment or .env; else the
// rendered globe's, which is the file's unless one of those replaced it; empty means devnet.test.
// A setting that differs from the rendered globe's means the render is stale: refused, unless
// this run is about to render again (rendering). `set` is the setting alone, for render --domain.
export function resolveDomain({ root = ROOT, env = process.env, rendering = false } = {}) {
  const p = paths(root);
  const set = setting('DEVNET_DOMAIN', { root, env });
  const rendered = envGet('DEVNET_DOMAIN', p.globeEnv);
  if (set && rendered && set !== rendered && !rendering)
    throw new Error(`DEVNET_DOMAIN=${set}, but the globe in data/globe/ was rendered for ${rendered}; run scripts/https-up.sh`);
  const domain = set || rendered || 'devnet.test';
  // A domain name and nothing else. This also refuses ${...} in .env, which compose would
  // expand and these scripts do not.
  if (/[^A-Za-z0-9.-]/.test(domain) || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..'))
    throw new Error(`DEVNET_DOMAIN=${domain} is not a domain name (set in the environment or .env)`);
  return { domain, set };
}

// The rendered globe's facts (globe.env): its domain, its PDSes by name, the one with bare
// handles (<name>.<domain>, '' if none), those that take an invite code, the seed and authority
// PDSes, and the names under the domain a bare handle would take.
export function globeFacts({ root = ROOT, env = process.env } = {}) {
  const p = paths(root);
  if (!existsSync(p.globeEnv)) throw new Error(`No ${p.globeEnv}: run scripts/https-up.sh, which renders it`);
  const list = (name) => envGet(name, p.globeEnv).split(' ').filter(Boolean);
  return {
    domain: resolveDomain({ root, env }).domain,
    pds: list('SNOWGLOBE_PDS'),
    bare: envGet('SNOWGLOBE_BARE_PDS', p.globeEnv),
    invites: list('SNOWGLOBE_INVITE_PDS'),
    seed: envGet('SNOWGLOBE_SEED_PDS', p.globeEnv),
    authority: envGet('SNOWGLOBE_AUTHORITY_PDS', p.globeEnv),
    taken: list('SNOWGLOBE_TAKEN'),
  };
}

// The address nginx publishes 443 on, worked out as compose works out ${DEVNET_BIND:-127.0.0.1}.
// A loopback address only (127.x.y.z, one per globe run side by side): the globe's logins are
// throwaway, so it is never published beyond this machine.
export function resolveBind({ root = ROOT, env = process.env } = {}) {
  const bind = setting('DEVNET_BIND', { root, env }) || '127.0.0.1';
  const parts = bind.split('.');
  if (parts.length !== 4 || parts[0] !== '127' || parts.slice(1).some((x) => !/^[0-9]+$/.test(x) || Number(x) > 255))
    throw new Error(`DEVNET_BIND=${bind} is not a loopback address 127.x.y.z (set in the environment or .env)`);
  return bind;
}

// Replace the lines of an env file matching `drop` with `add` (lines, no newlines). The file is
// mode 600, and never readable by anyone else, even briefly: it is written aside at 600, then
// renamed over the old one.
export function envPut(file, drop, add = []) {
  const kept = lines(file).filter((l) => l !== '' && !drop.test(l));
  const text = [...kept, ...add].map((l) => `${l}\n`).join('');
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
}

// Mode 600, even if a container wrote the file: it then belongs to root, and only a rewrite
// makes it ours.
export function makePrivate(file) {
  if (!existsSync(file)) return;
  if (statSync(file).uid === process.getuid?.()) chmodSync(file, 0o600);
  else envPut(file, /^$/);
}

// The env file for logins: made if missing, and private either way.
export function loginsFile(file) {
  if (!existsSync(file)) envPut(file, /^$/);
  makePrivate(file);
  return file;
}

// Add a handle to the names https-run maps to nginx; a process already running under it picks a
// new one up when it restarts.
export function addName(host, { root = ROOT } = {}) {
  const p = paths(root);
  mkdirSync(p.https, { recursive: true });
  if (!lines(p.names).includes(host)) appendFileSync(p.names, `${host}\n`);
}

// docker compose on `project` with the rendered globe. Its paths are from the repo root, which is
// also where compose reads .env. Returns spawnSync's result; stdio as given (inherited by default).
export function dc(project, args, { root = ROOT, stdio = 'inherit', encoding } = {}) {
  const p = paths(root);
  if (!existsSync(p.compose)) throw new Error(`No ${p.compose}: run scripts/https-up.sh, which renders it`);
  return spawnSync('docker', ['compose', '-p', project, '--project-directory', root, '-f', p.compose, ...args], {
    stdio,
    encoding,
  });
}

// An https request to a globe's name: the name goes to nginx on DEVNET_BIND, and TLS is verified
// against the globe's CA. With DEVNET_PUBLIC=1 the names are public ones with a real certificate
// (a globe on the cluster), so the URL is used as it stands, through public DNS and the system's
// CAs. Resolves to { status, body } (body a string); never logs the request or the answer.
export function devnetRequest(url, { method = 'GET', headers = {}, body, root = ROOT, env = process.env } = {}) {
  const pub = env.DEVNET_PUBLIC === '1';
  const options = { method, headers };
  if (!pub) {
    const bind = resolveBind({ root, env });
    options.ca = readFileSync(paths(root).ca);
    options.lookup = (_host, opts, cb) =>
      opts?.all ? cb(null, [{ address: bind, family: 4 }]) : cb(null, bind, 4);
  }
  return new Promise((done, fail) => {
    const req = request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end(body);
  });
}
