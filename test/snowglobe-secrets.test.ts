// The secrets a snowglobe's services start with (lib/env.mjs SECRETS, ensureSecrets): random, made
// once per snowglobe, kept private in its state folder, overridden by the environment, and kept
// at the old fixed value where the snowglobe's data was made under it.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { SECRETS, adminPassword, ensureSecrets, paths } from '../lib/env.mjs';

const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'snowglobe-secrets-root-'));
  const state = join(mkdtempSync(join(tmpdir(), 'snowglobe-secrets-')), 'g');
  return { root, state };
};
const NAMES = Object.keys(SECRETS);

describe('the services\' secrets', () => {
  it('are none until up makes them', () => {
    const { root, state } = fresh();
    expect(adminPassword({ root, state, env: {} })).toBe('');
  });

  it('are made random, once, in a file only the owner can read, and differ between snowglobes', () => {
    const { root, state } = fresh();
    const first = ensureSecrets({ root, state, env: {} });
    expect(first.kept).toEqual([]);
    expect(Object.keys(first.values)).toEqual(NAMES);
    for (const n of NAMES) expect(first.values[n], n).toMatch(new RegExp(`^[0-9a-f]{${SECRETS[n].bytes * 2}}$`));
    expect(new Set(Object.values(first.values)).size).toBe(NAMES.length);
    const file = paths(root, state).secrets;
    expect(readFileSync(file, 'utf8')).toBe(NAMES.map((n) => `${n}=${first.values[n]}\n`).join(''));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(ensureSecrets({ root, state, env: {} }).values).toEqual(first.values);
    expect(adminPassword({ root, state, env: {} })).toBe(first.values.SG_PDS_ADMIN_PASSWORD);
    const other = fresh();
    const second = ensureSecrets({ root: other.root, state: other.state, env: {} });
    for (const n of NAMES) expect(second.values[n], n).not.toBe(first.values[n]);
  });

  it('have no fixed value in the compose files', () => {
    for (const f of ['docker-compose.yml', 'docker-compose.test.yml', 'docker-compose.relay.yml']) {
      const text = readFileSync(join(__dirname, '..', 'stack', f), 'utf8');
      for (const [name, { legacy }] of Object.entries(SECRETS) as [string, { legacy?: string }][]) {
        expect(text, `${f}: ${name} has a default`).not.toContain(`\${${name}:-`);
        // 'postgres' is also a service's name; the default check above covers it.
        if (legacy && legacy !== 'postgres') expect(text, `${f}: ${legacy}`).not.toContain(legacy);
      }
    }
  });

  it('are the environment\'s when that is set, and then make no file', () => {
    const { root, state } = fresh();
    const env = Object.fromEntries(NAMES.map((n) => [n, `mine-${n}`]));
    const got = ensureSecrets({ root, state, env, hasData: () => { throw new Error('asked'); } });
    expect(got.values).toEqual(env);
    expect(existsSync(paths(root, state).secrets)).toBe(false);
  });

  it('make only the ones that are missing, and do not ask about data when none is', () => {
    const { root, state } = fresh();
    const first = ensureSecrets({ root, state, env: {} });
    const again = ensureSecrets({ root, state, env: { SG_DB_PASSWORD: 'mine' }, hasData: () => { throw new Error('asked'); } });
    expect(again.values.SG_DB_PASSWORD).toBe('mine');
    expect(again.values.SG_PDS_JWT_SECRET).toBe(first.values.SG_PDS_JWT_SECRET);
  });

  it('keep the old fixed value where the snowglobe already has data, and say which, except the admin password', () => {
    const { root, state } = fresh();
    const got = ensureSecrets({ root, state, env: {}, hasData: () => true });
    expect(got.kept.sort()).toEqual(['SG_DB_PASSWORD', 'SG_PDS_JWT_SECRET', 'SG_PLC_ROTATION_KEY', 'SG_RELAY_ADMIN_PASSWORD']);
    expect(got.values.SG_DB_PASSWORD).toBe('postgres');
    expect(got.values.SG_PLC_ROTATION_KEY).toBe('0123456789abcdef'.repeat(4));
    expect(got.values.SG_PDS_ADMIN_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
    // Written, so the next up neither asks nor says it again.
    const next = ensureSecrets({ root, state, env: {}, hasData: () => { throw new Error('asked'); } });
    expect(next.values).toEqual(got.values);
    expect(next.kept).toEqual([]);
  });
});
