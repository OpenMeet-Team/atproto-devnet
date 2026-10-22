// Where a snowglobe's state is and which file owns it (lib/state.mjs, lib/env.mjs): the state
// folder per user, the file found from the folder you are in, the compose project from its name,
// the refusal of a second file with the same name, and the notice for a checkout's old data/.
// No Docker needed: the CLI runs on a copy of bin/ and lib/ in a temporary root, with a docker on
// PATH that only records what it was asked. Run them alone with `npx vitest run snowglobe-state`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { oldDataNotice, stateRoot } from '../lib/env.mjs';
// @ts-expect-error: a plain .mjs module, without types
import { findFile } from '../lib/state.mjs';

const ROOT = join(__dirname, '..');
const FOUR = join(ROOT, 'test/snowglobe/four.yml');

describe('stateRoot', () => {
  const home = '/home/u';
  it('is under XDG_DATA_HOME, else ~/.local/share', () => {
    expect(stateRoot({ XDG_DATA_HOME: '/x/data' }, { platform: 'linux', home })).toBe('/x/data/snowglobe');
    expect(stateRoot({}, { platform: 'linux', home })).toBe('/home/u/.local/share/snowglobe');
    expect(stateRoot({}, { platform: 'darwin', home })).toBe('/home/u/.local/share/snowglobe');
  });

  it('ignores a relative XDG_DATA_HOME, as the XDG rules say', () => {
    expect(stateRoot({ XDG_DATA_HOME: 'data' }, { platform: 'linux', home })).toBe('/home/u/.local/share/snowglobe');
  });

  it('is under LOCALAPPDATA on Windows', () => {
    const win = stateRoot({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, { platform: 'win32', home: 'C:\\Users\\u' });
    expect(win.startsWith('C:\\Users\\u\\AppData\\Local')).toBe(true);
    expect(win.endsWith('snowglobe')).toBe(true);
  });
});

describe('findFile', () => {
  const tree = () => {
    const top = mkdtempSync(join(tmpdir(), 'snowglobe-find-'));
    mkdirSync(join(top, 'a/b/c'), { recursive: true });
    return top;
  };

  it('takes the file given, then SG_FILE, then the nearest snowglobe.yml at or above the folder', () => {
    const top = tree();
    writeFileSync(join(top, 'snowglobe.yml'), 'globe: top\n');
    writeFileSync(join(top, 'a/snowglobe.yml'), 'globe: mid\n');
    expect(findFile({ file: 'x.yml', env: { SG_FILE: 'y.yml' }, cwd: top })).toBe('x.yml');
    expect(findFile({ env: { SG_FILE: 'y.yml' }, cwd: top })).toBe('y.yml');
    expect(findFile({ env: {}, cwd: top })).toBe('snowglobe.yml');
    expect(findFile({ env: {}, cwd: join(top, 'a/b/c') })).toBe(join(top, 'a/snowglobe.yml'));
  });

  it('falls back to the default globe at the repo root', () => {
    expect(findFile({ env: {}, cwd: tmpdir() })).toBe(join(ROOT, 'snowglobe.default.yml'));
  });
});

describe('oldDataNotice', () => {
  const checkout = (files: string[]) => {
    const r = mkdtempSync(join(tmpdir(), 'snowglobe-old-'));
    for (const f of files) {
      mkdirSync(join(r, 'data', f, '..'), { recursive: true });
      writeFileSync(join(r, 'data', f), f === 'devnet.env' ? 'SG_PROJECT=devnet-spaces\n' : 'x\n');
    }
    return r;
  };

  it('is null for a checkout with no globe in data/ (the plain http stack keeps its logins there)', () => {
    expect(oldDataNotice(checkout(['accounts.env']), '/s/four')).toBeNull();
  });

  it('names the move, and the compose project the old globe ran under', () => {
    const text = oldDataNotice(checkout(['devnet.env', 'accounts.env', 'globe/compose.yml']), '/s/four', 'linux');
    expect(text).toContain('mkdir -p "/s/four/https"');
    expect(text).toMatch(/mv ".*\/data\/accounts\.env" "\/s\/four\/accounts\.env"/);
    expect(text).toMatch(/mv ".*\/data\/globe" "\/s\/four\/globe"/);
    expect(text).toContain('SG_PROJECT=devnet-spaces snowglobe up');
    expect(text).toContain('Nothing was changed');
  });

  it('says it in PowerShell on Windows', () => {
    const text = oldDataNotice(checkout(['devnet.env']), 'C:\\s\\four', 'win32');
    expect(text).toContain('Move-Item');
    expect(text).toContain('$env:SG_PROJECT=devnet-spaces');
  });

  it('is null once the state folder has the globe', () => {
    const r = checkout(['devnet.env']);
    const s = mkdtempSync(join(tmpdir(), 'snowglobe-state-'));
    mkdirSync(join(s, 'globe'));
    writeFileSync(join(s, 'globe/compose.yml'), 'services: {}\n');
    expect(oldDataNotice(r, s)).toBeNull();
  });
});

// A root with bin/ and lib/, a docker on PATH that writes what it was asked to docker.log and
// fails, and HOME (so the state) inside it.
function box() {
  const r = mkdtempSync(join(tmpdir(), 'snowglobe-box-'));
  for (const d of ['bin', 'lib', 'https/dns', 'https/proxy', 'pdsls']) cpSync(join(ROOT, d), join(r, d), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(r, 'node_modules'));
  writeFileSync(join(r, 'package.json'), '{"type": "module"}\n');
  for (const f of ['docker-compose.yml', 'docker-compose.test.yml', 'docker-compose.relay.yml']) cpSync(join(ROOT, f), join(r, f));
  const shim = join(r, 'shim');
  mkdirSync(shim);
  symlinkSync(process.execPath, join(shim, 'node'));
  writeFileSync(join(shim, 'docker'), `#!/bin/sh\necho "$*" >> ${join(r, 'docker.log')}\nexit "\${SHIM_EXIT:-1}"\n`, { mode: 0o755 });
  return r;
}
function sg(r: string, cwd: string, args: string[], env: Record<string, string> = {}) {
  const base = { PATH: `${join(r, 'shim')}:${process.env.PATH}`, HOME: r, SG_BIND: '127.77.0.9' };
  return spawnSync(join(r, 'shim/node'), [join(r, 'bin/snowglobe.mjs'), ...args], { cwd, env: { ...base, ...env }, encoding: 'utf8', timeout: 60000 });
}
const dockerLog = (r: string) => (existsSync(join(r, 'docker.log')) ? readFileSync(join(r, 'docker.log'), 'utf8') : '');
const tree = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name])) : [];

describe('a snowglobe is found from the folder you are in', () => {
  it('renders the same file from a subfolder, into the user\'s state and not the checkout', () => {
    const r = box();
    mkdirSync(join(r, 'proj/src/deep'), { recursive: true });
    cpSync(FOUR, join(r, 'proj/snowglobe.yml'));
    const here = sg(r, join(r, 'proj'), ['render']);
    const below = sg(r, join(r, 'proj/src/deep'), ['render']);
    expect(here.status, here.stderr).toBe(0);
    expect(below.status, below.stderr).toBe(0);
    expect(here.stdout).toContain('snowglobe.yml:');
    expect(below.stdout).toContain(`${join(r, 'proj/snowglobe.yml')}:`);
    expect(existsSync(join(r, '.local/share/snowglobe/four/globe/compose.yml'))).toBe(true);
    expect(readFileSync(join(r, '.local/share/snowglobe/four/owner'), 'utf8').trim()).toContain('proj/snowglobe.yml');
    expect(existsSync(join(r, 'data'))).toBe(false);
  });

  it('puts the state under XDG_DATA_HOME when it is set', () => {
    const r = box();
    cpSync(FOUR, join(r, 'snowglobe.yml'));
    expect(sg(r, r, ['render'], { XDG_DATA_HOME: join(r, 'xdg') }).status).toBe(0);
    expect(existsSync(join(r, 'xdg/snowglobe/four/globe/compose.yml'))).toBe(true);
    expect(existsSync(join(r, '.local'))).toBe(false);
  });

  it('keeps the state apart by globe name, so a second snowglobe needs no second checkout', () => {
    const r = box();
    mkdirSync(join(r, 'one'));
    mkdirSync(join(r, 'two'));
    cpSync(FOUR, join(r, 'one/snowglobe.yml'));
    writeFileSync(join(r, 'two/snowglobe.yml'), readFileSync(FOUR, 'utf8').replace('globe: four', 'globe: other'));
    expect(sg(r, join(r, 'one'), ['render']).status).toBe(0);
    expect(sg(r, join(r, 'two'), ['render']).status).toBe(0);
    expect(readdirSync(join(r, '.local/share/snowglobe')).sort()).toEqual(['four', 'other']);
  });

  it('refuses a second file with the same globe name, naming the first and the fix, before docker', () => {
    const r = box();
    mkdirSync(join(r, 'one'));
    mkdirSync(join(r, 'two'));
    cpSync(FOUR, join(r, 'one/snowglobe.yml'));
    cpSync(FOUR, join(r, 'two/snowglobe.yml'));
    expect(sg(r, join(r, 'one'), ['render']).status).toBe(0);
    const before = tree(join(r, '.local/share/snowglobe'));
    for (const args of [['up'], ['render'], ['down'], ['account', 'x', 'X']]) {
      const res = sg(r, join(r, 'two'), args);
      expect(res.status, args[0]).toBe(1);
      expect(res.stderr, args[0]).toContain(join(r, 'one/snowglobe.yml'));
      expect(res.stderr, args[0]).toContain('another name');
    }
    expect(dockerLog(r)).toBe('');
    expect(tree(join(r, '.local/share/snowglobe'))).toEqual(before);
  });

  it('lets a file take over a name whose first file is gone', () => {
    const r = box();
    mkdirSync(join(r, 'one'));
    mkdirSync(join(r, 'two'));
    cpSync(FOUR, join(r, 'one/snowglobe.yml'));
    cpSync(FOUR, join(r, 'two/snowglobe.yml'));
    expect(sg(r, join(r, 'one'), ['render']).status).toBe(0);
    spawnSync('rm', ['-r', join(r, 'one')]);
    expect(sg(r, join(r, 'two'), ['render']).status).toBe(0);
    expect(readFileSync(join(r, '.local/share/snowglobe/four/owner'), 'utf8')).toContain(join(r, 'two'));
  });

  it('keeps the old checkout\'s data/ as it was, and starts nothing, when up finds a globe in it', () => {
    const r = box();
    cpSync(FOUR, join(r, 'snowglobe.yml'));
    mkdirSync(join(r, 'data/globe'), { recursive: true });
    mkdirSync(join(r, 'data/https'), { recursive: true });
    writeFileSync(join(r, 'data/globe/compose.yml'), 'services: {}\n');
    writeFileSync(join(r, 'data/devnet.env'), 'SG_PROJECT=mine\n');
    writeFileSync(join(r, 'data/https/ca.crt'), 'x');
    const before = tree(join(r, 'data'));
    const res = sg(r, r, ['up']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('mv ');
    expect(res.stderr).toContain('SG_PROJECT=mine snowglobe up');
    expect(tree(join(r, 'data'))).toEqual(before);
    expect(dockerLog(r)).toBe('');
    expect(existsSync(join(r, '.local'))).toBe(false);
  });
});
