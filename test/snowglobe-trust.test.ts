// snowglobe trust (lib/trust.mjs, lib/commands/trust.mjs). Nothing here touches the machine's own
// trust stores or browser profiles: the commands are built against a temporary HOME and recorded by
// a shim, and the one real run goes to a temporary NSS database, only where certutil is installed.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { ensureCerts } from '../lib/certs.mjs';
// @ts-expect-error: a plain .mjs module, without types
import { applySteps, caName, realContext, trustSteps } from '../lib/trust.mjs';

const ROOT = join(__dirname, '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'snowglobe-trust-'));
const hasCertutil = spawnSync('certutil', ['-H'], { encoding: 'utf8' }).error === undefined;

async function makeCa() {
  const dir = tmp();
  await ensureCerts({ dir: join(dir, 'g'), caDir: join(dir, 'ca'), domain: 'local.snowglobe.at', names: ['local.snowglobe.at'] });
  return { dir, ca: join(dir, 'ca/ca.crt') };
}

// A context that records every command and answers checks from `answers` (by the command's text).
function shim(over: Record<string, unknown> = {}, answers: Record<string, number> = {}) {
  const calls: { argv: string[]; capture: boolean }[] = [];
  const ctx = {
    platform: 'linux',
    env: {},
    home: tmp(),
    isRoot: false,
    wsl: false,
    onPath: (c: string) => ['update-ca-certificates', 'certutil', 'sudo'].includes(c),
    exec: (argv: string[], { capture = false } = {}) => {
      calls.push({ argv, capture });
      return { status: answers[argv.join(' ')] ?? 0, stdout: '' };
    },
    ...over,
  };
  return { ctx, calls, loud: () => calls.filter((c) => !c.capture).map((c) => c.argv.join(' ')) };
}
const quiet = () => {
  const lines: string[] = [];
  return { lines, say: (l: string) => lines.push(l) };
};

describe('snowglobe trust: building the steps', () => {
  it('Linux: system store through sudo, then the shared NSS database', async () => {
    const { ca } = await makeCa();
    // certutil -L answers 1: not listed
    const { ctx, loud } = shim({ exec: (a: string[]) => ({ status: a[0] === 'certutil' ? 1 : 0, stdout: '' }) });
    const steps = trustSteps(ca, ctx);
    expect(steps.map((s: { label: string }) => s.label)).toEqual(['system store (update-ca-certificates)', 'Chrome, Edge, Chromium (~/.pki/nssdb)']);
    const out = quiet();
    const r = applySteps(steps, { ctx, say: out.say, dryRun: true });
    expect(r.failed).toBe(0);
    const text = out.lines.join('\n');
    expect(text).toContain('[needs sudo]');
    expect(text).toContain(`sudo install -m 644 ${ca} /usr/local/share/ca-certificates/snowglobe-ca.crt`);
    expect(text).toContain('sudo update-ca-certificates');
    expect(text).toContain(`certutil -N -d sql:${ctx.home}/.pki/nssdb --empty-password`);
    expect(text).toContain(`-t C,, -n '${caName(ca)}' -i ${ca}`);
    // A dry run runs no command that changes anything.
    expect(loud()).toEqual([]);
  });

  it('runs sudo steps with sudo, and without it as root', async () => {
    const { ca } = await makeCa();
    for (const isRoot of [false, true]) {
      const { ctx, loud } = shim({ isRoot }, { 'certutil -L': 1 });
      const steps = trustSteps(ca, ctx).slice(0, 1);
      // not present: the file is not there
      applySteps(steps, { ctx, say: () => {} });
      expect(loud()[0]).toBe(`${isRoot ? '' : 'sudo '}install -m 644 ${ca} /usr/local/share/ca-certificates/snowglobe-ca.crt`);
    }
  });

  it('--no-sudo prints the sudo steps and runs nothing, and says it did not finish', async () => {
    const { ca } = await makeCa();
    const { ctx, loud } = shim();
    const out = quiet();
    const r = applySteps(trustSteps(ca, ctx).slice(0, 1), { ctx, say: out.say, noSudo: true });
    expect(r.failed).toBe(1);
    expect(loud()).toEqual([]);
    expect(out.lines.join('\n')).toContain('sudo update-ca-certificates');
  });

  it('a step whose store has the CA is skipped on add, and one without it on remove', async () => {
    const { ca } = await makeCa();
    const { ctx, loud } = shim();
    const nss = trustSteps(ca, ctx)[1];
    // certutil -L answers 0 (listed), and the database exists
    mkdirSync(join(ctx.home, '.pki/nssdb'), { recursive: true });
    writeFileSync(join(ctx.home, '.pki/nssdb/cert9.db'), '');
    const again = trustSteps(ca, ctx)[1];
    expect(again.present()).toBe(true);
    const out = quiet();
    expect(applySteps([again], { ctx, say: out.say }).done).toBe(1);
    expect(loud()).toEqual([]);
    expect(out.lines.join('\n')).toContain('already trusted');
    expect(nss.add.length).toBeGreaterThan(1);
  });

  it('a missing certutil is reported with what to install, and counts as not done', async () => {
    const { ca } = await makeCa();
    const { ctx, loud } = shim({ onPath: (c: string) => c === 'update-ca-certificates' });
    const out = quiet();
    const r = applySteps(trustSteps(ca, ctx).slice(1), { ctx, say: out.say });
    expect(r.failed).toBe(1);
    expect(out.lines.join('\n')).toContain('libnss3-tools');
    expect(loud()).toEqual([]);
  });

  it('WSL: also prints the PowerShell step for the Windows user store', async () => {
    const { ca } = await makeCa();
    const { ctx } = shim({ wsl: true });
    const steps = trustSteps(ca, { ...ctx, exec: (a: string[]) => ({ status: 0, stdout: a[0] === 'wslpath' ? '\\\\wsl.localhost\\Debian\\ca.crt\n' : '' }) });
    const win = steps.at(-1);
    expect(win.manual).toBe(true);
    const out = quiet();
    applySteps([win], { ctx, say: out.say });
    expect(out.lines.join('\n')).toContain("certutil -user -addstore Root '\\\\wsl.localhost\\Debian\\ca.crt'");
    const rm = quiet();
    applySteps([win], { ctx, say: rm.say, remove: true });
    expect(rm.lines.join('\n')).toContain(`certutil -user -delstore Root '${caName(ca)}'`);
  });

  it('macOS and Windows build their own commands', async () => {
    const { ca } = await makeCa();
    const mac = trustSteps(ca, shim({ platform: 'darwin', home: '/Users/t' }).ctx);
    expect(mac[0].add[0]).toEqual(['security', 'add-trusted-cert', '-r', 'trustRoot', '-k', '/Users/t/Library/Keychains/login.keychain-db', ca]);
    expect(mac[0].remove[0].slice(0, 4)).toEqual(['security', 'delete-certificate', '-c', caName(ca)]);
    const win = trustSteps(ca, shim({ platform: 'win32' }).ctx);
    expect(win[0].add[0]).toEqual(['certutil', '-user', '-addstore', 'Root', ca]);
  });

  it('finds Firefox profiles that have a database', async () => {
    const { ca } = await makeCa();
    const { ctx } = shim();
    const p = join(ctx.home, '.mozilla/firefox/abc.default');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'cert9.db'), '');
    mkdirSync(join(ctx.home, '.mozilla/firefox/Crash Reports'), { recursive: true });
    const labels = trustSteps(ca, ctx).map((s: { label: string }) => s.label);
    expect(labels).toContain(`Firefox profile ${p}`);
    expect(labels.filter((l: string) => l.startsWith('Firefox'))).toHaveLength(1);
  });
});

describe.skipIf(!hasCertutil)('snowglobe trust: a real NSS database', () => {
  it('lists the CA once after two trusts, and not after remove', async () => {
    const { ca } = await makeCa();
    const home = tmp();
    // Only the NSS step, and a PATH without the system-store tools.
    const ctx = realContext({ ...process.env, HOME: home, PATH: process.env.PATH });
    const nssOnly = () => trustSteps(ca, { ...ctx, home }).filter((s: { label: string }) => s.label.startsWith('Chrome'));
    const db = `sql:${home}/.pki/nssdb`;
    const listed = () => spawnSync('certutil', ['-L', '-d', db], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes(caName(ca))).length;
    const say = () => {};
    expect(applySteps(nssOnly(), { ctx, say }).failed).toBe(0);
    expect(listed()).toBe(1);
    expect(applySteps(nssOnly(), { ctx, say }).failed).toBe(0);
    expect(listed()).toBe(1);
    expect(applySteps(nssOnly(), { ctx, say, remove: true }).failed).toBe(0);
    expect(listed()).toBe(0);
    // and again: nothing to remove is not an error
    expect(applySteps(nssOnly(), { ctx, say, remove: true }).failed).toBe(0);
    expect(existsSync(join(home, '.pki/nssdb/cert9.db'))).toBe(true);
  });
});

describe('snowglobe trust: the command', () => {
  const trust = (args: string[], xdg: string) =>
    spawnSync('node', [join(ROOT, 'bin/snowglobe.mjs'), 'trust', ...args], { encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: xdg } });
  it('exits 2 with no CA, and says what makes one', () => {
    const r = trust(['--dry-run'], tmp());
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('snowglobe up');
  });
  it('refuses a word it does not know', () => {
    expect(trust(['--force'], tmp()).status).toBe(2);
    expect(trust(['--remove', '--remove'], tmp()).status).toBe(2);
  });
  it('--dry-run changes nothing and exits 0', async () => {
    const xdg = tmp();
    await ensureCerts({ dir: join(xdg, 'snowglobe/g'), caDir: join(xdg, 'snowglobe/ca'), domain: 'local.snowglobe.at', names: ['local.snowglobe.at'] });
    const home = tmp();
    const r = spawnSync('node', [join(ROOT, 'bin/snowglobe.mjs'), 'trust', '--dry-run'], { encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: xdg, HOME: home } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('dry run');
    expect(existsSync(join(home, '.pki'))).toBe(false);
  });
});
