// What every snowglobe subcommand shares: where the files are, the domain and the address the
// globe is under (read as compose reads them), env files that hold logins, docker compose on the
// rendered globe, and https to a globe's names. Nothing here prints a secret.
//

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DOMAIN } from './config.mjs';

// A mistake in how a command was called, as opposed to one the globe answered with.
export class UsageError extends Error {}

// A refusal with its own exit code (3: the shared devnet, guarded).
export class Refused extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

/**
 * The compose project up and down act on: SG_PROJECT if set, else `name`, the globe's name in
 * its snowglobe.yml. Refused before anything else is done: none (a usage mistake), or
 * devnet-spaces, the shared devnet, without SG_RESET_OK=1 (exit 3).
 */
export function guardProject(env = process.env, name) {
  const project = env.SG_PROJECT || name;
  if (!project) throw new UsageError('no compose project: name one with SG_PROJECT, or run in a folder with a snowglobe.yml');
  if (project === 'devnet-spaces' && env.SG_RESET_OK !== '1')
    throw new Refused('refusing devnet-spaces, the shared devnet; set SG_RESET_OK=1 only for a planned reset', 3);
  return project;
}

// The repo root, which is also the compose project directory, where compose reads .env.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The folder all snowglobe state is under, for this user and not this checkout:
 * $XDG_DATA_HOME/snowglobe, else %LOCALAPPDATA%\\snowglobe on Windows, else
 * ~/.local/share/snowglobe. Each snowglobe has a folder of its own in it, named for the file's
 * `globe:`, and ca/ holds the one certificate authority they all use.
 */
export function stateRoot(env = process.env, { platform = process.platform, home = homedir() } = {}) {
  // XDG's rule: a relative XDG_DATA_HOME is ignored.
  if (env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)) return join(env.XDG_DATA_HOME, 'snowglobe');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'snowglobe');
  return join(home, '.local', 'share', 'snowglobe');
}

// The settings file compose reads beside the compose files (the repo root's .env).
export const dotenvFile = (root = ROOT) => join(root, '.env');

/**
 * The files a snowglobe keeps in `state`, its folder under stateRoot(), and the user's CA beside
 * it (<stateRoot>/ca). Nothing is kept in the checkout.
 */
export function paths(root = ROOT, state) {
  if (!state) throw new Error('no state folder given (a snowglobe keeps its files in one: lib/state.mjs session)');
  const data = state;
  const https = join(data, 'https');
  const globe = join(data, 'globe');
  const caDir = join(dirname(state), 'ca');
  return {
    root,
    data,
    https,
    // The CA, one per user, which run's processes and snowglobeRequest trust.
    caDir,
    ca: join(caDir, 'ca.crt'),
    // The snowglobe's own logins: the base init's alice, bob and invite code, the lexicon
    // authority, and accounts made by snowglobe account.
    accounts: join(data, 'accounts.env'),
    // The PDSes' admin password, made by up (random, once) and read by account and invite.
    // A file of its own: the base init rewrites accounts.env.
    admin: join(data, 'admin.env'),
    // App routes, "<name> <port> [<ending>]" per line (snowglobe app).
    apps: join(https, 'apps'),
    // Handles run maps to nginx, one per line (snowglobe account and up).
    names: join(https, 'names'),
    // The rendered globe (bin/snowglobe.mjs render). Nothing in it is secret.
    globe,
    globeEnv: join(globe, 'globe.env'),
    leafNames: join(globe, 'leaf-names'),
    compose: join(globe, 'compose.yml'),
    dotenv: dotenvFile(root),
  };
}

// Files an older snowglobe kept in <root>/data, before state moved to the user's folder.
const OLD_FILES = ['accounts.env', 'accounts.json', 'devnet.env', 'globe', 'https/apps', 'https/names'];

/**
 * The text that says a checkout still holds a snowglobe's files from before state moved to the
 * user's folder (<root>/data/globe or data/devnet.env) while `state` has none, with the command
 * that moves them; null when it does not. Nothing is moved by snowglobe itself.
 */
export function oldDataNotice(root, state, platform = process.platform) {
  const data = join(root, 'data');
  if (!(existsSync(join(data, 'globe', 'compose.yml')) || existsSync(join(data, 'devnet.env')))) return null;
  if (existsSync(join(state, 'globe', 'compose.yml'))) return null;
  const project = envGet('SG_PROJECT', join(data, 'devnet.env'));
  const found = OLD_FILES.filter((f) => existsSync(join(data, f)));
  const win = platform === 'win32';
  const q = (x) => `"${x}"`;
  const move = win
    ? [`New-Item -ItemType Directory -Force ${q(join(state, 'https'))}`, ...found.map((f) => `Move-Item ${q(join(data, f))} ${q(join(state, f))}`)]
    : [`mkdir -p ${q(join(state, 'https'))}`, ...found.map((f) => `mv ${q(join(data, f))} ${q(join(state, f))}`)];
  return [
    `${data} holds a snowglobe from before state moved out of the checkout (into ${state}). Nothing was changed.`,
    `To keep it, move its files${project ? ` and keep its compose project (its containers and volumes belong to ${project})` : ''}:`,
    ...move.map((l) => `  ${l}`),
    project ? `  ${win ? '$env:SG_PROJECT' : 'SG_PROJECT'}=${project} snowglobe up` : '  snowglobe up',
    "Either way it trusts a new CA, once: snowglobe now makes one for you in place of the checkout's old one.",
  ].join('\n');
}

/**
 * The text that says the default snowglobe was named devnet before it was named snowglobe, and an
 * install made under the old name is still in the state root while `state` has none, with the
 * commands to keep it or drop it; null when it does not. Nothing is moved by snowglobe itself.
 * A snowglobe made from a file of your own is not affected: it keeps the file's `globe:` name.
 */
export function renamedDefaultNotice(root, state, platform = process.platform) {
  const old = join(dirname(state), 'devnet');
  if (!existsSync(join(old, 'globe', 'compose.yml')) || existsSync(join(state, 'globe', 'compose.yml'))) return null;
  const win = platform === 'win32';
  const q = (x) => `"${x}"`;
  const keep = win
    ? [`Move-Item ${q(old)} ${q(state)}`, "$env:SG_PROJECT='devnet'", 'snowglobe up --default']
    : [`mv ${q(old)} ${q(state)}`, 'SG_PROJECT=devnet snowglobe up --default'];
  return [
    `${old} holds the default snowglobe from before it was renamed (it was called devnet, and is called snowglobe now). Nothing was changed.`,
    'To keep it, with its accounts, move its folder and keep its compose project (its containers and volumes belong to devnet; their network and images are recreated under the new names):',
    ...keep.map((l) => `  ${l}`),
    'To drop it, remove its containers and volumes, then delete the folder:',
    `  docker compose -p devnet --project-directory ${q(root)} -f ${q(join(old, 'globe', 'compose.yml'))} down -v`,
    `  ${win ? 'Remove-Item -Recurse' : 'rm -r'} ${q(old)}`,
  ].join('\n');
}

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []);

// Until 2026-10-20 the settings were DEVNET_* and SNOWGLOBE_*; every one is SG_* now. The old
// names still work for a while: adoptOldNames copies each one to its SG_ name, and envGet falls
// back to them in a file written before the change.
const OLD_NAME = /^(?:DEVNET|SNOWGLOBE)_([A-Za-z0-9_]+)$/;
const oldNames = (name) => (name.startsWith('SG_') ? [`DEVNET_${name.slice(3)}`, `SNOWGLOBE_${name.slice(3)}`] : []);

// The last value of NAME in an env file the scripts write (NAME=value, nothing else), or ''.
// An SG_ name the file lacks is looked up under its old names.
export function envGet(name, file) {
  const ls = lines(file);
  for (const n of [name, ...oldNames(name)]) {
    let value;
    for (const l of ls) if (l.startsWith(`${n}=`)) value = l.slice(n.length + 1);
    if (value !== undefined) return value;
  }
  return '';
}

/**
 * Each old setting (DEVNET_*, SNOWGLOBE_*) in the environment or .env whose SG_ name neither sets
 * is copied into env under the SG_ name, so the commands and compose see it; one warning names
 * them. Returns the old names taken.
 */
export function adoptOldNames({ root = ROOT, env = process.env, warn = (m) => console.error(m) } = {}) {
  const dotenv = dotenvFile(root);
  const taken = new Map();
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(OLD_NAME);
    if (m && env[`SG_${m[1]}`] === undefined) taken.set(`SG_${m[1]}`, { old: k, value: v });
  }
  for (const l of lines(dotenv)) {
    const k = l.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=/)?.[1];
    const m = k?.match(OLD_NAME);
    const name = m && `SG_${m[1]}`;
    if (m && env[name] === undefined && !taken.has(name) && envCompose(name, dotenv) === undefined)
      taken.set(name, { old: `${k} (in .env)`, value: envCompose(k, dotenv) });
  }
  for (const [name, { value }] of taken) env[name] = value;
  if (taken.size)
    warn(
      `snowglobe: old setting names, still read for now: ${[...taken].map(([name, { old }]) => `${old} is now ${name}`).join('; ')}`,
    );
  return [...taken.values()].map((t) => t.old);
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
  return env[name] !== undefined ? env[name] : (envCompose(name, dotenvFile(root)) ?? '');
}

// The domain every globe name sits under: SG_DOMAIN from the environment or .env; else the
// rendered globe's, which is the file's unless one of those replaced it; empty means DEFAULT_DOMAIN.
// A setting that differs from the rendered globe's means the render is stale: refused, unless
// this run is about to render again (rendering). `set` is the setting alone, for render --domain.
export function resolveDomain({ root = ROOT, state, env = process.env, rendering = false } = {}) {
  const p = paths(root, state);
  const set = setting('SG_DOMAIN', { root, env });
  const rendered = envGet('SG_DOMAIN', p.globeEnv);
  if (set && rendered && set !== rendered && !rendering)
    throw new Error(`SG_DOMAIN=${set}, but the globe in ${p.globe} was rendered for ${rendered}; run snowglobe up`);
  const domain = set || rendered || DEFAULT_DOMAIN;
  // A domain name and nothing else. This also refuses ${...} in .env, which compose would
  // expand and these scripts do not.
  if (/[^A-Za-z0-9.-]/.test(domain) || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..'))
    throw new Error(`SG_DOMAIN=${domain} is not a domain name (set in the environment or .env)`);
  return { domain, set };
}

// The rendered globe's facts (globe.env): its domain, its PDSes by name, the one with bare
// handles (<name>.<domain>, '' if none), those that take an invite code, the seed and authority
// PDSes, and the names under the domain a bare handle would take.
export function globeFacts({ root = ROOT, state, env = process.env } = {}) {
  const p = paths(root, state);
  if (!existsSync(p.globeEnv)) throw new Error(`No ${p.globeEnv}: run snowglobe up, which renders it`);
  const list = (name) => envGet(name, p.globeEnv).split(' ').filter(Boolean);
  return {
    domain: resolveDomain({ root, state, env }).domain,
    pds: list('SG_PDS'),
    bare: envGet('SG_BARE_PDS', p.globeEnv),
    invites: list('SG_INVITE_PDS'),
    seed: envGet('SG_SEED_PDS', p.globeEnv),
    authority: envGet('SG_AUTHORITY_PDS', p.globeEnv),
    taken: list('SG_TAKEN'),
  };
}

// The address nginx publishes 443 on, worked out as compose works out ${SG_BIND:-127.0.0.1}.
// A loopback address only (127.x.y.z, one per globe run side by side): the globe's logins are
// throwaway, so it is never published beyond this machine.
export function resolveBind({ root = ROOT, env = process.env } = {}) {
  const bind = setting('SG_BIND', { root, env }) || '127.0.0.1';
  const parts = bind.split('.');
  if (parts.length !== 4 || parts[0] !== '127' || parts.slice(1).some((x) => !/^[0-9]+$/.test(x) || Number(x) > 255))
    throw new Error(`SG_BIND=${bind} is not a loopback address 127.x.y.z (set in the environment or .env)`);
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

// Add a handle to the names run maps to nginx; a process already running under it picks a
// new one up when it restarts.
export function addName(host, { root = ROOT, state } = {}) {
  const p = paths(root, state);
  mkdirSync(p.https, { recursive: true });
  if (!lines(p.names).includes(host)) appendFileSync(p.names, `${host}\n`);
}

// The PDSes' admin password: SG_PDS_ADMIN_PASSWORD from the environment or .env (a globe on the
// cluster has its own), else the one up made for this snowglobe in its admin.env; '' when neither.
export function adminPassword({ root = ROOT, state, env = process.env } = {}) {
  return setting('SG_PDS_ADMIN_PASSWORD', { root, env }) || (state ? envGet('SG_PDS_ADMIN_PASSWORD', paths(root, state).admin) : '');
}

// adminPassword, made first when there is none: 24 random bytes, kept in admin.env (mode 600) so
// the same one is used on every later up and read by account and invite. Never printed.
export function ensureAdminPassword({ root = ROOT, state, env = process.env } = {}) {
  const have = adminPassword({ root, state, env });
  if (have) return have;
  const p = paths(root, state);
  mkdirSync(p.data, { recursive: true });
  const password = randomBytes(24).toString('hex');
  envPut(loginsFile(p.admin), /^SG_PDS_ADMIN_PASSWORD=/, [`SG_PDS_ADMIN_PASSWORD=${password}`]);
  return password;
}

// docker compose on `project` with the rendered globe. Its paths are from the repo root, which is
// also where compose reads .env. Returns spawnSync's result; stdio as given (inherited by default),
// env as given (this process's by default), for compose to fill the file's ${...} from.
export function dc(project, args, { root = ROOT, state, stdio = 'inherit', encoding, env } = {}) {
  const p = paths(root, state);
  if (!existsSync(p.compose)) {
    const old = oldDataNotice(root, state);
    throw new Error(`No ${p.compose}: run snowglobe up, which renders it${old ? `\n${old}` : ''}`);
  }
  // compose fills ${SG_PDS_ADMIN_PASSWORD} in the file from this, and refuses to read the file
  // without it. up makes the real one first; down and ps on a snowglobe from before it have none,
  // and need only a value for compose to read the file.
  const base = env ?? process.env;
  const password = adminPassword({ root, state, env: base }) || 'unset-run-snowglobe-up';
  return spawnSync('docker', ['compose', '-p', project, '--project-directory', root, '-f', p.compose, ...args], {
    stdio,
    encoding,
    env: { ...base, SG_PDS_ADMIN_PASSWORD: password },
  });
}

// An https request to a globe's name: the name goes to nginx on SG_BIND, and TLS is verified
// against the globe's CA. With SG_PUBLIC=1 the names are public ones with a real certificate
// (a globe on the cluster), so the URL is used as it stands, through public DNS and the system's
// CAs. Resolves to { status, body } (body a string); never logs the request or the answer.
export function snowglobeRequest(url, { method = 'GET', headers = {}, body, root = ROOT, state, env = process.env } = {}) {
  const pub = env.SG_PUBLIC === '1';
  const options = { method, headers };
  if (!pub) {
    const bind = resolveBind({ root, env });
    options.ca = readFileSync(paths(root, state).ca);
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
