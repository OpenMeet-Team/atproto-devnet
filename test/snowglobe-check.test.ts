// snowglobe check needs no Docker: it reads a snowglobe.yml and says what is wrong with it.
// Run it alone with `npx vitest run snowglobe-check`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { checkGlobe } from '../scripts/snowglobe-config.mjs';

const ROOT = join(__dirname, '..');
const FIXTURES = join(__dirname, 'snowglobe');

function check(...args: string[]) {
  const r = spawnSync('node', [join(ROOT, 'scripts/snowglobe'), 'check', ...args], { encoding: 'utf8', cwd: FIXTURES });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const PDS_A = { name: 'alpha', image: 'spaces-alpha' };
const PDS_B = { name: 'beta', image: 'ghcr.io/bluesky-social/pds:0.4.5037' };

describe('snowglobe check', () => {
  it('passes the default globe, which is today\'s https devnet', () => {
    const r = check(join(ROOT, 'snowglobe.default.yml'));
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('PDSs alpha regular prod');
  });

  it('uses the default globe when there is no snowglobe.yml', () => {
    const r = check();
    expect(r.code).toBe(0);
    expect(r.out).toContain('snowglobe.default.yml: ok');
  });

  it('passes a file that uses every setting', () => {
    const r = check('full.yml');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
  });

  it.each([
    ['no-pds.yml', 'pds: required: at least one PDS'],
    ['duplicate-pds.yml', 'pds[1].name: "alpha" is already used by pds[0].name'],
    ['pds-grouphost-clash.yml', 'grouphosts[0].name: "alpha" is already used by pds[0].name'],
    ['two-bare.yml', 'only one PDS can take bare handles'],
    ['authority-unlisted.yml', 'lexicons.authority: "beta" is not a PDS in this file'],
    ['latest-image.yml', 'is :latest, which moves'],
    ['bad-label.yml', 'pds[0].name: "Alpha_1" must be one lowercase DNS label'],
  ])('fails %s, naming the problem', (file, message) => {
    const r = check(file);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
  });

  it('fails a file that is not there, or not YAML', () => {
    expect(check('missing.yml').err).toContain('cannot read it');
  });

  it('fails an unknown command', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts/snowglobe'), 'up'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});

describe('the rules behind the check', () => {
  it('fills in the defaults', () => {
    const { globe, errors } = checkGlobe({ globe: 'mine', pds: [PDS_A] });
    expect(errors).toEqual([]);
    expect(globe.domain).toBe('devnet.test');
    expect(globe.pds[0].image).toContain('@sha256:');
    expect(globe.pds[0].invites).toBe('open');
    expect(globe.services.relay).toBe(false); // one PDS: Jetstream follows it directly
    expect(globe.lexicons.authority).toBe('alpha');
  });

  it('turns the relay on with more than one PDS, and refuses it off', () => {
    expect(checkGlobe({ globe: 'mine', pds: [PDS_A, PDS_B] }).globe.services.relay).toBe(true);
    const { errors } = checkGlobe({ globe: 'mine', pds: [PDS_A, PDS_B], services: { relay: false } });
    expect(errors.join('\n')).toContain('services.relay: cannot be off with more than one PDS');
  });

  it('keeps the network\'s own names for the network', () => {
    const { errors } = checkGlobe({ globe: 'mine', pds: [{ ...PDS_A, name: 'relay' }] });
    expect(errors.join('\n')).toContain('"relay" is taken by the network itself');
  });

  it('refuses a bare handle that is another server\'s address', () => {
    const { errors } = checkGlobe({
      globe: 'mine',
      pds: [{ ...PDS_A, bare_handles: true }, PDS_B],
      accounts: ['beta@alpha', 'carol@beta'],
    });
    expect(errors).toEqual(['accounts[0]: "beta.devnet.test" would be the address of pds[1].name']);
  });

  it('names the handle each account gets', () => {
    const { globe } = checkGlobe({
      globe: 'mine',
      pds: [{ ...PDS_A, bare_handles: true }, PDS_B],
      accounts: ['alice@alpha', 'bob@beta'],
    });
    expect(globe.accounts.map((a: { handle: string }) => a.handle)).toEqual(['alice.devnet.test', 'bob.beta.devnet.test']);
  });

  it('refuses an unpinned image, an unknown setting and an unknown group host kind', () => {
    const { errors } = checkGlobe({
      globe: 'mine',
      pds: [{ name: 'alpha', image: 'ghcr.io/bluesky-social/pds' }],
      grouphosts: [{ name: 'gh', kind: 'other' }],
      sevices: {},
    });
    const all = errors.join('\n');
    expect(all).toContain('pds[0].image: "ghcr.io/bluesky-social/pds" has no tag or digest');
    expect(all).toContain('grouphosts[0].kind: "other" is not a kind of group host');
    expect(all).toContain('sevices: unknown setting');
  });
});
