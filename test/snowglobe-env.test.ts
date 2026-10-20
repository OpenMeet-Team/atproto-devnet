// The shared core of the snowglobe subcommands (scripts/snowglobe-env.mjs): reading settings as
// compose reads .env, the refusals, and the env files that hold logins. No Docker needed; run
// them alone with `npx vitest run snowglobe-env`.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { envCompose, envGet, envPut, makePrivate, resolveBind, resolveDomain } from '../scripts/snowglobe-env.mjs';

function root(dotenv?: string, globeDomain?: string) {
  const r = mkdtempSync(join(tmpdir(), 'snowglobe-env-'));
  if (dotenv !== undefined) writeFileSync(join(r, '.env'), dotenv);
  if (globeDomain !== undefined) {
    mkdirSync(join(r, 'data/globe'), { recursive: true });
    writeFileSync(join(r, 'data/globe/globe.env'), `# rendered\nDEVNET_DOMAIN=${globeDomain}\n`);
  }
  return r;
}

describe('envCompose', () => {
  const file = (text: string) => {
    const f = join(mkdtempSync(join(tmpdir(), 'snowglobe-env-')), '.env');
    writeFileSync(f, text);
    return f;
  };

  it('reads a value as compose does', () => {
    expect(envCompose('D', file('D=a.test\n'))).toBe('a.test');
    expect(envCompose('D', file('export D=a.test\n'))).toBe('a.test');
    expect(envCompose('D', file('  D = a.test  \n'))).toBe('a.test');
    expect(envCompose('D', file('D="a.test" # note\n'))).toBe('a.test');
    expect(envCompose('D', file("D='a b'\n"))).toBe('a b');
    expect(envCompose('D', file('D=a.test # note\n'))).toBe('a.test');
    expect(envCompose('D', file('D=a.test\r\nE=x\r\n'))).toBe('a.test');
  });

  it('takes the last value, and tells unset from empty', () => {
    expect(envCompose('D', file('D=a.test\nD=b.test\n'))).toBe('b.test');
    expect(envCompose('D', file('D=\n'))).toBe('');
    expect(envCompose('D', file('DD=a.test\n'))).toBeUndefined();
    expect(envCompose('D', join(tmpdir(), 'no-such-file.env'))).toBeUndefined();
  });

  it('envGet reads only NAME=value lines the scripts write', () => {
    const f = file('A=1\n A=2\nA=3\nAB=4\n');
    expect(envGet('A', f)).toBe('3');
    expect(envGet('B', f)).toBe('');
  });
});

describe('resolveDomain', () => {
  it('takes the environment, then .env, then the rendered globe, then devnet.test', () => {
    expect(resolveDomain({ root: root('DEVNET_DOMAIN=env.test\n'), env: { DEVNET_DOMAIN: 'x.test' }, rendering: true }).domain).toBe('x.test');
    expect(resolveDomain({ root: root('DEVNET_DOMAIN=env.test\n'), env: {} }).domain).toBe('env.test');
    expect(resolveDomain({ root: root(undefined, 'globe.test'), env: {} }).domain).toBe('globe.test');
    expect(resolveDomain({ root: root(), env: {} }).domain).toBe('devnet.test');
  });

  it('lets an empty setting in the environment win over .env, and fall through to the globe', () => {
    const r = root('DEVNET_DOMAIN=env.test\n', 'globe.test');
    expect(resolveDomain({ root: r, env: { DEVNET_DOMAIN: '' } })).toEqual({ domain: 'globe.test', set: '' });
  });

  it('refuses a stale render, unless this run renders again', () => {
    const r = root(undefined, 'globe.test');
    expect(() => resolveDomain({ root: r, env: { DEVNET_DOMAIN: 'other.test' } })).toThrow(/rendered for globe\.test/);
    expect(resolveDomain({ root: r, env: { DEVNET_DOMAIN: 'other.test' }, rendering: true }).domain).toBe('other.test');
  });

  it('refuses what is not a domain name', () => {
    for (const d of ['a b.test', '.a.test', 'a.test.', 'a..test', '${X}.test'])
      expect(() => resolveDomain({ root: root(), env: { DEVNET_DOMAIN: d } }), d).toThrow(/not a domain name/);
  });
});

describe('resolveBind', () => {
  it('takes a loopback address from the environment or .env, 127.0.0.1 by default', () => {
    expect(resolveBind({ root: root(), env: {} })).toBe('127.0.0.1');
    expect(resolveBind({ root: root('DEVNET_BIND=127.0.0.2\n'), env: {} })).toBe('127.0.0.2');
    expect(resolveBind({ root: root('DEVNET_BIND=127.0.0.2\n'), env: { DEVNET_BIND: '127.0.0.3' } })).toBe('127.0.0.3');
  });

  it('refuses anything that is not 127.x.y.z', () => {
    for (const b of ['0.0.0.0', '192.168.1.2', '127.0.0', '127.0.0.256', '127.0.0.x', 'localhost'])
      expect(() => resolveBind({ root: root(), env: { DEVNET_BIND: b } }), b).toThrow(/not a loopback/);
  });
});

describe('env files with logins', () => {
  it('envPut replaces the matching lines and keeps the file at mode 600', () => {
    const f = join(root(), 'accounts.env');
    writeFileSync(f, 'A_DID=1\nB_DID=2\nA_PASSWORD=x\n', { mode: 0o644 });
    envPut(f, /^A_(DID|PASSWORD)=/, ['A_DID=3', 'A_PASSWORD=y']);
    expect(readFileSync(f, 'utf8')).toBe('B_DID=2\nA_DID=3\nA_PASSWORD=y\n');
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it('envPut makes a missing file', () => {
    const f = join(root(), 'new.env');
    envPut(f, /^V=/, ['V=1']);
    expect(readFileSync(f, 'utf8')).toBe('V=1\n');
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it('makePrivate makes a file mode 600 and leaves a missing one alone', () => {
    const r = root();
    const f = join(r, 'accounts.json');
    writeFileSync(f, '{}\n', { mode: 0o644 });
    makePrivate(f);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readFileSync(f, 'utf8')).toBe('{}\n');
    expect(() => makePrivate(join(r, 'missing'))).not.toThrow();
  });
});
