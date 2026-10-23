// The PDSes' admin password (lib/env.mjs adminPassword, ensureAdminPassword): random, made once
// per snowglobe, kept private in its state folder, and overridden by SG_PDS_ADMIN_PASSWORD.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { adminPassword, ensureAdminPassword, paths } from '../lib/env.mjs';

const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), 'snowglobe-admin-root-'));
  const state = join(mkdtempSync(join(tmpdir(), 'snowglobe-admin-')), 'g');
  return { root, state };
};

describe('the PDS admin password', () => {
  it('is none until up makes it', () => {
    const { root, state } = fresh();
    expect(adminPassword({ root, state, env: {} })).toBe('');
  });

  it('is made random, once, in a file only the owner can read', () => {
    const { root, state } = fresh();
    const first = ensureAdminPassword({ root, state, env: {} });
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    const file = paths(root, state).admin;
    expect(readFileSync(file, 'utf8')).toBe(`SG_PDS_ADMIN_PASSWORD=${first}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(ensureAdminPassword({ root, state, env: {} })).toBe(first);
    expect(adminPassword({ root, state, env: {} })).toBe(first);
    const other = fresh();
    expect(ensureAdminPassword({ root: other.root, state: other.state, env: {} })).not.toBe(first);
  });

  it('is the environment\'s when that is set, and then makes no file', () => {
    const { root, state } = fresh();
    expect(ensureAdminPassword({ root, state, env: { SG_PDS_ADMIN_PASSWORD: 'mine' } })).toBe('mine');
    expect(existsSync(paths(root, state).admin)).toBe(false);
  });
});
