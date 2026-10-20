#!/usr/bin/env node
// The whole snowglobe sequence on this machine, end to end: check, up, account on two PDSes,
// invite, lexicons, app add, run (names, the CA, each PDS's health and the app), app --remove,
// down -v. One line per step, ok or FAIL, and exit 0 only when every step passed. Nothing secret
// is printed: accounts print their DID, invite and lexicons print nothing a login needs.
//
//   node scripts/smoke.mjs
//
// It runs on a copy of this checkout in a temporary folder (data/, .git and node_modules left out;
// node_modules is linked), so the checkout's own data/ (its CA, logins and app routes) is never
// touched, and the copy keeps every file as checked out, line endings and .env included. The
// globe is compose project snowglobe-smoke, on its own ports and loopback address, beside any other
// globe: DEVNET_BIND and DEVNET_DOMAIN come from the environment or the copied .env if set there,
// else 127.0.0.3 and the default file's domain, and the step "devnet.env" checks up read them.
// The copy is taken down with -v at the end whatever happened; its folder is left for a look.
//
// Needs Docker with compose, Node 20+ and, for the run steps, Linux with bubblewrap.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'data', 'node_modules']);
const PROJECT = 'snowglobe-smoke';
const APP_PORT = 5597;

const root = mkdtempSync(join(tmpdir(), 'snowglobe-smoke-'));
for (const name of readdirSync(SRC)) if (!SKIP.has(name)) cpSync(join(SRC, name), join(root, name), { recursive: true });
symlinkSync(join(SRC, 'node_modules'), join(root, 'node_modules'));

const { setting } = await import(join(root, 'lib/env.mjs'));
const env = {
  ...process.env,
  DEVNET_PROJECT: PROJECT,
  DEVNET_PLC_PORT: '2593',
  DEVNET_JETSTREAM_PORT: '6028',
  DEVNET_JETSTREAM_METRICS_PORT: '6029',
  DEVNET_MAILDEV_WEB_PORT: '1092',
  DEVNET_MAILDEV_SMTP_PORT: '1037',
  DEVNET_PROXY_PORT: '1093',
  DEVNET_BIND: setting('DEVNET_BIND', { root }) || '127.0.0.3',
};
for (const k of ['SNOWGLOBE_FILE', 'ACCOUNTS_FILE', 'DEVNET_PUBLIC', 'DEVNET_RESET_OK']) delete env[k];
const wantDomain = setting('DEVNET_DOMAIN', { root }) || 'devnet.test';

const sg = (args, opts = {}) =>
  spawnSync(process.execPath, [join(root, 'bin/snowglobe.mjs'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 900_000, ...opts });
const run = (args, extra = {}) => sg(['run', '--', ...args], { env: { ...env, ...extra } });

let failed = 0;
function step(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}
// The last line of a failed command's stderr, which names what went wrong.
const why = (r) => (r.error?.message ?? r.stderr ?? '').trim().split('\n').pop();
const version = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).stdout?.trim().split('\n')[0] || 'missing';

console.log(`copy: ${root}`);
console.log(`node ${process.version}; ${version('docker', ['compose', 'version'])}; bwrap ${version('bwrap', ['--version'])}; ${process.platform}`);
console.log(`domain ${wantDomain}, bind ${env.DEVNET_BIND}, project ${PROJECT}\n`);

// The app, in a process of its own: this one waits on each command in turn, and would not answer.
let listener;
try {
  let r = sg(['check']);
  step('check', r.status === 0, why(r));

  r = sg(['up']);
  if (!step('up', r.status === 0, r.status === 0 ? '' : why(r))) throw new Error('up failed');

  const denv = readFileSync(join(root, 'data/devnet.env'), 'utf8');
  const fact = (k) => denv.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
  step('devnet.env', fact('DEVNET_DOMAIN') === wantDomain && fact('DEVNET_BIND') === env.DEVNET_BIND, `DEVNET_DOMAIN=${fact('DEVNET_DOMAIN')} DEVNET_BIND=${fact('DEVNET_BIND')}`);

  r = sg(['account', 'smoke-one', 'SMOKE_ONE']);
  step('account on the bare-handle PDS', r.status === 0 && r.stdout.startsWith('did:'), why(r));
  r = sg(['account', 'smoke-two', 'SMOKE_TWO', 'regular']);
  step('account on regular', r.status === 0 && r.stdout.startsWith('did:'), why(r));
  r = sg(['account', 'smoke-one', 'SMOKE_ONE']);
  step('account rerun finds it', r.status === 0 && /^Found /m.test(r.stderr), why(r));

  r = sg(['invite', 'SMOKE_INVITE']);
  const accounts = readFileSync(join(root, 'data/accounts.env'), 'utf8');
  step('invite', r.status === 0 && /^SMOKE_INVITE=./m.test(accounts), why(r));

  const lex = join(root, 'smoke-lexicons');
  mkdirSync(lex);
  for (const id of ['test.smoke.one', 'test.smoke.two'])
    writeFileSync(join(lex, `${id}.json`), JSON.stringify({ lexicon: 1, id, defs: { main: { type: 'token' } } }));
  r = sg(['lexicons', lex]);
  step('lexicons', r.status === 0 && r.stdout.trim().split('\n').length === 2, why(r));

  listener = spawn(process.execPath, ['-e', `require('http').createServer((q, s) => s.end('smokeapp')).listen(${APP_PORT}, '0.0.0.0', () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => listener.stdout.once('data', ok));
  r = sg(['app', 'smokeapp', String(APP_PORT), 'sm']);
  step('app add', r.status === 0, why(r));

  const names = [wantDomain, ...['alpha', 'regular', 'prod'].map((p) => `${p}.${wantDomain}`), 'plc.directory', 'smokeapp.devnet.internal'];
  r = run(['getent', 'hosts', ...names]);
  const mapped = (r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith(`${env.DEVNET_BIND} `)).length;
  step('run maps the names', r.status === 0 && mapped === names.length, `${mapped} of ${names.length} on ${env.DEVNET_BIND}`);

  // Node under run, with no flags: the names resolve and the CA is trusted.
  const fetches = `
    const urls = ['alpha', 'regular', 'prod'].map((p) => 'https://${wantDomain}/health/' + p).concat('https://smokeapp.devnet.internal/x');
    Promise.all(urls.map((u) => fetch(u).then((r) => r.status, (e) => e.cause?.code ?? e.message))).then((s) => console.log(s.join(' ')));`;
  r = run([process.execPath, '-e', fetches]);
  step('run: health of each PDS, and the app', r.stdout?.trim() === '200 200 200 200', r.stdout?.trim() || why(r));

  r = sg(['app', '--remove', 'smokeapp']);
  step('app --remove', r.status === 0, why(r));
  // run maps only routed apps, so the name is added to reach nginx at all. nginx reloads in the
  // background, so the old route can answer for a moment.
  let gone = '';
  for (let n = 0; n < 10 && gone !== '404'; n++) {
    gone = run([process.execPath, '-e', "fetch('https://smokeapp.devnet.internal/x').then((r) => console.log(r.status), (e) => console.log(e.cause?.code ?? e.message))"], { HTTPS_RUN_EXTRA_NAMES: 'smokeapp.devnet.internal' }).stdout?.trim();
    if (gone !== '404') spawnSync('sleep', ['1']);
  }
  step('removed app answers 404', gone === '404', gone);
} catch (e) {
  if (e.message !== 'up failed') step('smoke', false, e.message);
} finally {
  listener?.kill();
  const r = sg(['down', '-v'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const count = (args) =>
    spawnSync('docker', [...args, '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter(Boolean).length;
  const containers = count(['ps', '-a']);
  const volumes = count(['volume', 'ls']);
  step('down -v leaves nothing', r.status === 0 && containers === 0 && volumes === 0, `${containers} containers, ${volumes} volumes`);
}

console.log(`\n${failed ? `${failed} step(s) FAILED` : 'every step passed'}; the copy is ${root}`);
process.exit(failed ? 1 : 0);
