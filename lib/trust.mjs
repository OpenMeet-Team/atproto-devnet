// Trusting the per-user CA (<state root>/ca/ca.crt) in the places a browser or a program looks, and
// undoing it. One function per platform builds the steps for it, and the command runs them the same
// way on every platform (lib/commands/trust.mjs).
//
// A step is { label, sudo, present(), add: [argv...], remove: [argv...], missing?, manual?, note? }:
//   present()  true when the CA is already in that store, false when not, null when it can't be told
//   add/remove the commands that put the CA there or take it out, as argument lists (printed as
//              they run, so nothing is hidden)
//   sudo       the commands need root; run through `sudo` unless we are root already
//   missing    a tool the step needs that is not installed (what to install); the step is printed,
//              not run
//   manual     the step happens outside this machine's reach (Windows from WSL); it is printed
//
// The CA is limited by name constraints (lib/certs.mjs): it can only vouch for the snowglobe's
// domain, devnet.internal and plc.directory, and for no IP address. Linux (OpenSSL, NSS), Windows and
// macOS all enforce them, so trusting the CA machine-wide does not let it vouch for any other site.
// They stay as they are.

import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// The CA's own name, from its subject: each CA has one of its own, which is also the nickname it
// goes by in the NSS and Windows stores.
export function caName(crt) {
  const subject = new X509Certificate(readFileSync(crt)).subject;
  const cn = subject.split('\n').find((l) => l.startsWith('CN='));
  if (!cn) throw new Error(`${crt} has no common name`);
  return cn.slice(3);
}

/** What the steps run on: real by default; tests pass their own `exec`, `onPath`, `isRoot` and `home`. */
export function realContext(env = process.env) {
  const onPath = (cmd) => {
    for (const dir of (env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) if (dir && existsSync(join(dir, cmd))) return true;
    return false;
  };
  return {
    platform: process.platform,
    env,
    home: env.HOME || env.USERPROFILE || '',
    isRoot: typeof process.getuid === 'function' && process.getuid() === 0,
    onPath,
    // Runs argv; { status, stdout }. `capture` keeps the output (a check); otherwise the command talks to the terminal (a password prompt).
    exec: (argv, { capture = false } = {}) => {
      const r = spawnSync(argv[0], argv.slice(1), { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
      return { status: r.error ? 127 : r.status, stdout: r.stdout ?? '' };
    },
  };
}

const ok = (ctx, argv) => ctx.exec(argv, { capture: true }).status === 0;

/** True when the machine is Windows Subsystem for Linux (a Linux whose browser usually runs on Windows). */
export function isWsl(ctx) {
  if (ctx.platform !== 'linux') return false;
  if (ctx.wsl !== undefined) return ctx.wsl;
  if (ctx.env.WSL_DISTRO_NAME || ctx.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
  } catch {
    return false;
  }
}

// ---- Linux ----------------------------------------------------------------------------------

// The system store: Debian's update-ca-certificates or Fedora's update-ca-trust. Read by curl,
// Node with --use-openssl-ca, Python, Go and the like.
function linuxOsStep(ca, ctx) {
  const same = (file) => existsSync(file) && readFileSync(file, 'utf8') === readFileSync(ca, 'utf8');
  if (ctx.onPath('update-ca-certificates')) {
    const file = '/usr/local/share/ca-certificates/snowglobe-ca.crt';
    return {
      label: 'system store (update-ca-certificates)',
      sudo: true,
      present: () => same(file),
      add: [['install', '-m', '644', ca, file], ['update-ca-certificates']],
      remove: [['rm', '-f', file], ['update-ca-certificates', '--fresh']],
    };
  }
  if (ctx.onPath('update-ca-trust')) {
    const file = '/etc/pki/ca-trust/source/anchors/snowglobe-ca.crt';
    return {
      label: 'system store (update-ca-trust)',
      sudo: true,
      present: () => same(file),
      add: [['install', '-m', '644', ca, file], ['update-ca-trust', 'extract']],
      remove: [['rm', '-f', file], ['update-ca-trust', 'extract']],
    };
  }
  return {
    label: 'system store',
    sudo: true,
    present: () => null,
    add: [],
    remove: [],
    manual: true,
    note: 'neither update-ca-certificates nor update-ca-trust is installed; add the CA to this system\'s store by its own tool',
  };
}

// One NSS database (Chrome, Edge and Chromium read ~/.pki/nssdb; each Firefox profile has its own).
// `create` makes an empty one when there is none (only the shared one is ever made).
function nssStep(label, dir, ca, nick, ctx, { create = false } = {}) {
  const db = `sql:${dir}`;
  const have = existsSync(join(dir, 'cert9.db'));
  const step = {
    label,
    sudo: false,
    present: () => (!ctx.onPath('certutil') ? null : have && ok(ctx, ['certutil', '-L', '-d', db, '-n', nick])),
    add: [
      ...(have || !create ? [] : [['mkdir', '-p', dir], ['certutil', '-N', '-d', db, '--empty-password']]),
      ['certutil', '-A', '-d', db, '-t', 'C,,', '-n', nick, '-i', ca],
    ],
    remove: [['certutil', '-D', '-d', db, '-n', nick]],
  };
  if (!ctx.onPath('certutil')) step.missing = 'certutil (Debian and Ubuntu: apt install libnss3-tools; Fedora: dnf install nss-tools)';
  return step;
}

// Where Firefox keeps profiles on Linux: its own folder, and the snap and flatpak ones.
function firefoxProfiles(home) {
  const roots = [join(home, '.mozilla/firefox'), join(home, 'snap/firefox/common/.mozilla/firefox'), join(home, '.var/app/org.mozilla.firefox/.mozilla/firefox')];
  return roots.flatMap((root) => {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'cert9.db')))
      .map((e) => join(root, e.name));
  });
}

function linuxSteps(ca, nick, ctx) {
  const steps = [linuxOsStep(ca, ctx), nssStep('Chrome, Edge, Chromium (~/.pki/nssdb)', join(ctx.home, '.pki/nssdb'), ca, nick, ctx, { create: true })];
  // A snap Chromium keeps its own copy of the shared database.
  const snap = join(ctx.home, 'snap/chromium/current/.pki/nssdb');
  if (existsSync(join(snap, 'cert9.db'))) steps.push(nssStep('Chromium snap', snap, ca, nick, ctx));
  for (const dir of firefoxProfiles(ctx.home)) steps.push(nssStep(`Firefox profile ${dir}`, dir, ca, nick, ctx));
  return steps;
}

// ---- WSL ------------------------------------------------------------------------------------

// The browser runs on Windows, whose user store a Linux program can't change silently (Windows
// asks you to confirm), so these are printed for you to run in PowerShell. The Linux steps still
// run, for what runs inside WSL.
function wslSteps(ca, nick, ctx) {
  let winPath = ctx.exec(['wslpath', '-w', ca], { capture: true });
  winPath = winPath.status === 0 ? winPath.stdout.trim() : '<the ca.crt above, as a Windows path (wslpath -w)>';
  return [
    ...linuxSteps(ca, nick, ctx),
    {
      label: 'Windows user store (Chrome, Edge, Firefox on Windows)',
      sudo: false,
      manual: true,
      present: () => null,
      add: [['certutil', '-user', '-addstore', 'Root', winPath]],
      remove: [['certutil', '-user', '-delstore', 'Root', nick]],
      note: 'run this in PowerShell on Windows; Windows asks you to confirm',
    },
  ];
}

// ---- macOS (not tried: no Mac was available when this was written) ------------------------------

function macSteps(ca, nick, ctx) {
  const keychain = join(ctx.home, 'Library/Keychains/login.keychain-db');
  return [
    {
      label: 'login keychain (Chrome, Edge, Safari)',
      sudo: false,
      present: () => ok(ctx, ['security', 'find-certificate', '-c', nick, keychain]),
      // macOS asks for your password or Touch ID itself.
      add: [['security', 'add-trusted-cert', '-r', 'trustRoot', '-k', keychain, ca]],
      remove: [['security', 'delete-certificate', '-c', nick, '-t', keychain]],
    },
    {
      label: 'Firefox',
      sudo: false,
      manual: true,
      present: () => null,
      add: [],
      remove: [],
      note: 'Firefox keeps its own list: Settings, Privacy & Security, View Certificates, Authorities, Import (remove it there too)',
    },
  ];
}

// ---- Windows ----------------------------------------------------------------------------------

function windowsSteps(ca, nick, ctx) {
  return [
    {
      label: 'Windows user store (Chrome, Edge, Firefox)',
      sudo: false,
      present: () => ok(ctx, ['certutil', '-user', '-store', 'Root', nick]),
      // Windows asks you to confirm; no administrator needed.
      add: [['certutil', '-user', '-addstore', 'Root', ca]],
      remove: [['certutil', '-user', '-delstore', 'Root', nick]],
    },
  ];
}

/** The steps for this platform, in order: [{ label, sudo, present, add, remove, ... }]. */
export function trustSteps(ca, ctx = realContext()) {
  const nick = caName(ca);
  if (ctx.platform === 'darwin') return macSteps(ca, nick, ctx);
  if (ctx.platform === 'win32') return windowsSteps(ca, nick, ctx);
  return isWsl(ctx) ? wslSteps(ca, nick, ctx) : linuxSteps(ca, nick, ctx);
}

const show = (argv) => argv.map((a) => (/[^\w@%+=:,./-]/.test(a) ? `'${a}'` : a)).join(' ');

/**
 * Run (or, with dryRun, only print) the steps to add the CA or, with `remove`, to take it out.
 * Every command is printed as it is run. Returns { done, failed, manual }: counts of steps taken
 * (or already in place), steps that could not be (a missing tool, a refused sudo, a failed
 * command, `noSudo`), and steps left for the user to run. Idempotent: a step whose store already
 * has the CA (or, for remove, no longer has it) is skipped.
 */
export function applySteps(steps, { remove = false, dryRun = false, noSudo = false, ctx = realContext(), say = console.log } = {}) {
  const out = { done: 0, failed: 0, manual: 0 };
  const wrap = (step, argv) => (step.sudo && !ctx.isRoot ? ['sudo', ...argv] : argv);
  for (const step of steps) {
    const cmds = remove ? step.remove : step.add;
    const verb = remove ? 'remove' : 'add';
    say(`${step.label}${step.sudo && !ctx.isRoot ? ' [needs sudo]' : ''}`);
    const print = (prefix) => cmds.forEach((c) => say(`  ${prefix}${show(wrap(step, c))}`));
    if (step.manual) {
      out.manual++;
      say(`  for you to ${verb}${step.note ? ` (${step.note})` : ''}:`);
      if (!cmds.length) continue;
      print('$ ');
      continue;
    }
    if (step.missing) {
      // Nothing to remove from a store that was never made.
      if (remove && !existsNss(step)) {
        say('  nothing to remove');
        out.done++;
        continue;
      }
      out.failed++;
      say(`  not done: needs ${step.missing}. Then run snowglobe trust${remove ? ' --remove' : ''} again; it would run:`);
      print('$ ');
      continue;
    }
    const present = step.present();
    if (remove ? present === false : present === true) {
      say(remove ? '  not in this store; nothing to remove' : '  already trusted; nothing to add');
      out.done++;
      continue;
    }
    if (noSudo && step.sudo && !ctx.isRoot) {
      out.failed++;
      say('  skipped (--no-sudo). To do it yourself:');
      print('$ ');
      continue;
    }
    if (dryRun) {
      say(`  would ${verb}:`);
      print('$ ');
      out.done++;
      continue;
    }
    if (step.sudo && !ctx.isRoot && !ctx.onPath('sudo')) {
      out.failed++;
      say('  not done: sudo is not installed. Run these as root:');
      cmds.forEach((c) => say(`  # ${show(c)}`));
      continue;
    }
    let good = true;
    for (const c of cmds) {
      say(`  $ ${show(wrap(step, c))}`);
      if (ctx.exec(wrap(step, c)).status !== 0) {
        good = false;
        break;
      }
    }
    say(good ? `  ${remove ? 'removed' : 'added'}` : '  failed');
    good ? out.done++ : out.failed++;
  }
  return out;
}

// A step's own database exists, so a missing certutil leaves something behind to remove.
const existsNss = (step) => step.remove.some((c) => c.some((a) => typeof a === 'string' && a.startsWith('sql:') && existsSync(join(a.slice(4), 'cert9.db'))));
