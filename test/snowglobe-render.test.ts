// snowglobe render needs no Docker to write the globe's files; one case asks `docker compose
// config` to read the result, and is skipped where there is no docker. Run them alone with
// `npx vitest run snowglobe-render`.
//
// The default globe's files are compared whole with test/snowglobe/rendered/, so any change to
// what the generator writes shows up in review. After an intended change, write them again with
// SNOWGLOBE_WRITE_RENDERED=1 npx vitest run snowglobe-render, and read the diff.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
// @ts-expect-error: a plain .mjs module, without types
import { checkGlobe, loadGlobe } from '../lib/config.mjs';
// @ts-expect-error: a plain .mjs module, without types
import { loadBase, renderGlobe } from '../lib/render.mjs';

const ROOT = join(__dirname, '..');
const RENDERED = join(__dirname, 'snowglobe', 'rendered');
const base = loadBase(ROOT);

function render(doc: object) {
  const { globe, errors } = checkGlobe(doc);
  expect(errors).toEqual([]);
  const files: Record<string, string> = renderGlobe(globe, base);
  return { files, compose: parse(files['compose.yml']), env: envOf(files['globe.env']) };
}
const envOf = (text: string) =>
  Object.fromEntries(text.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const PDS = (name: string, extra: object = {}) => ({ name, image: 'ghcr.io/bluesky-social/pds:0.4.5037', ...extra });
const THREE = { globe: 'mine', domain: 'mine.test', pds: [PDS('alpha', { bare_handles: true }), PDS('regular'), PDS('prod')] };
const FOUR = { ...THREE, pds: [...THREE.pds, PDS('beta')] };

describe('snowglobe render', () => {
  it('writes the default globe as test/snowglobe/rendered/ has it', () => {
    const { globe, errors } = loadGlobe(join(ROOT, 'snowglobe.default.yml'));
    expect(errors).toEqual([]);
    const files: Record<string, string> = renderGlobe(globe, base, { source: 'snowglobe.default.yml' });
    expect(Object.keys(files).sort()).toEqual(['compose.yml', 'globe.env', 'leaf-names', 'nginx/globe.conf', 'nginx/page.inc', 'page.json']);
    for (const [name, text] of Object.entries(files)) {
      const path = join(RENDERED, name);
      if (process.env.SNOWGLOBE_WRITE_RENDERED) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }
      expect(text, name).toBe(readFileSync(path, 'utf8'));
    }
  });

  it('runs one service per PDS, each on the plain network under its own name', () => {
    for (const doc of [THREE, FOUR]) {
      const { compose } = render(doc);
      const pds = Object.keys(compose.services).filter((s) => s.startsWith('pds-'));
      expect(pds).toEqual(doc.pds.map((p) => `pds-${p.name}`));
      for (const p of doc.pds) {
        const s = compose.services[`pds-${p.name}`];
        expect(s.network_mode).toBeUndefined();
        expect(s.environment.PDS_HOSTNAME).toBe(`${p.name}.mine.test`);
        expect(s.environment.PDS_SERVICE_DID).toBe(`did:web:${p.name}.mine.test`);
        expect(s.volumes).toContain(`pds-${p.name}-data:/pds/data`);
        expect(compose.volumes).toHaveProperty(`pds-${p.name}-data`);
      }
    }
  });

  it('shares no network namespace but Slingshot\'s', () => {
    const { compose } = render(FOUR);
    const shared = Object.entries(compose.services).filter(([, s]: [string, any]) => s.network_mode).map(([n]) => n);
    expect(shared).toEqual(['slingshot']);
  });

  it('gives a PDS with bare handles the domain\'s handles, and the others their own', () => {
    const { compose } = render(THREE);
    expect(compose.services['pds-alpha'].environment.PDS_SERVICE_HANDLE_DOMAINS).toBe('.mine.test');
    expect(compose.services['pds-regular'].environment.PDS_SERVICE_HANDLE_DOMAINS).toBe('.regular.mine.test');
  });

  it('requires invites only where the file says so', () => {
    const { compose } = render({ ...THREE, pds: [PDS('alpha', { invites: 'required' }), PDS('regular')] });
    expect(compose.services['pds-alpha'].environment.PDS_INVITE_REQUIRED).toBe('true');
    expect(compose.services['pds-regular'].environment.PDS_INVITE_REQUIRED).toBe('false');
  });

  it('has the relay crawl every PDS at its https name, and nginx answer to each inside the network', () => {
    const { compose } = render(FOUR);
    const names = FOUR.pds.map((p) => `${p.name}.mine.test`);
    expect(compose.services['relay-init'].environment.RELAY_HOSTS.split(' ')).toEqual(names);
    expect(compose.services.nginx.networks['atproto-devnet'].aliases).toEqual(names);
    expect(compose.services.jetstream.environment.JETSTREAM_WS_URL).toBe('ws://relay:2470/xrpc/com.atproto.sync.subscribeRepos');
    expect(compose.services.tap.environment.TAP_RELAY_URL).toBe('http://relay:2470');
  });

  it('routes each PDS\'s name and handles to its service, and puts both on the leaf', () => {
    const { files } = render(FOUR);
    const conf = files['nginx/globe.conf'];
    const leaf = files['leaf-names'].trim().split('\n');
    expect(conf).toMatch(/server_name alpha\.mine\.test \*\.mine\.test;\s+location \/ \{\s+set \$upstream http:\/\/pds-alpha:3000;/);
    for (const n of ['regular', 'prod', 'beta']) {
      expect(conf).toMatch(new RegExp(`server_name ${n}\\.mine\\.test \\*\\.${n}\\.mine\\.test;\\s+location / \\{\\s+set \\$upstream http://pds-${n}:3000;`));
      expect(leaf).toEqual(expect.arrayContaining([`${n}.mine.test`, `*.${n}.mine.test`]));
    }
    expect(conf).toMatch(/server_name relay\.mine\.test;\s+location \/ \{\s+set \$upstream http:\/\/relay:2470;/);
  });

  it('gives the page health and accounts for every PDS, and the seed PDS at /health/pds', () => {
    const { files } = render({ ...FOUR, pds: [PDS('regular'), PDS('alpha', { bare_handles: true }), PDS('beta')] });
    const inc = files['nginx/page.inc'];
    expect(inc).toMatch(/location = \/health\/pds \{ proxy_pass \$pds_alpha\//);
    for (const n of ['regular', 'alpha', 'beta']) {
      expect(inc).toContain(`set $pds_${n} http://pds-${n}:3000;`);
      expect(inc).toContain(`location = /health/${n} {`);
      expect(inc).toContain(`location = /people/${n}/listRepos {`);
    }
  });

  it('refuses a PDS named for one of the page\'s own health routes, which nginx would see twice', () => {
    const fixed = [...readFileSync(join(ROOT, 'page/devnet.conf'), 'utf8').matchAll(/location = \/health\/([a-z0-9-]+) /g)].map((m) => m[1]);
    expect(fixed.length).toBeGreaterThan(0);
    for (const name of [...fixed, 'pds']) {
      expect(checkGlobe({ ...THREE, pds: [PDS(name)] }).errors.map((e: string) => e.split(': ')[0]), name).toContain('pds[0].name');
    }
  });

  it('seeds init on the PDS with bare handles, else the first', () => {
    const bare = render({ ...THREE, pds: [PDS('regular'), PDS('alpha', { bare_handles: true })] });
    expect(bare.compose.services.init.depends_on).toHaveProperty('pds-alpha');
    expect(bare.compose.services.init.command[1]).toContain('http://pds-alpha:3000');
    expect(bare.env.SNOWGLOBE_SEED_PDS).toBe('alpha');
    const first = render({ ...THREE, pds: [PDS('regular'), PDS('prod')] });
    expect(first.compose.services.init.environment.HANDLE_DOMAIN).toBe('.regular.mine.test');
    expect(first.env.SNOWGLOBE_SEED_PDS).toBe('regular');
  });

  it('runs no relay for one PDS, and Jetstream and TAP read that PDS', () => {
    const { compose, files, env } = render({ globe: 'one', domain: 'one.test', pds: [PDS('solo')] });
    expect(compose.services).not.toHaveProperty('relay');
    expect(compose.services).not.toHaveProperty('relay-init');
    expect(compose.services.jetstream.environment.JETSTREAM_WS_URL).toBe('ws://pds-solo:3000/xrpc/com.atproto.sync.subscribeRepos');
    expect(compose.services.tap.environment.TAP_RELAY_URL).toBe('http://pds-solo:3000');
    expect(files['nginx/globe.conf']).not.toContain('relay.one.test');
    expect(env.SNOWGLOBE_ONESHOTS).toBe('init');
  });

  it('leaves out a service the file turns off, with its name and route', () => {
    const { compose, files, env } = render({ ...THREE, services: { pdsls: false, slingshot: false, tap: false } });
    for (const s of ['pdsls', 'slingshot', 'slingshot-dns', 'tap']) {
      expect(compose.services).not.toHaveProperty(s);
      expect(env.SNOWGLOBE_SERVICES.split(' ')).not.toContain(s);
    }
    for (const n of ['pdsls.mine.test', 'slingshot.mine.test']) {
      expect(files['nginx/globe.conf']).not.toContain(n);
      expect(files['leaf-names'].split('\n')).not.toContain(n);
    }
  });

  it('lists in globe.env every service it runs, the one-shots apart', () => {
    const { compose, env } = render(FOUR);
    const listed = [...env.SNOWGLOBE_SERVICES.split(' '), ...env.SNOWGLOBE_ONESHOTS.split(' ')];
    expect(listed.sort()).toEqual(Object.keys(compose.services).sort());
    expect(env.SNOWGLOBE_PDS).toBe('alpha regular prod beta');
    expect(env.DEVNET_DOMAIN).toBe('mine.test');
  });

  it('tells snowglobe account which PDS has bare handles, which take invites, and which names are taken', () => {
    const { env } = render({
      ...FOUR,
      pds: [PDS('alpha', { bare_handles: true, invites: 'required' }), PDS('regular'), PDS('beta', { invites: 'required' })],
      grouphosts: [{ name: 'gh', kind: 'opensocial' }],
      apps: [{ name: 'atmo', local: { port: 5173, handles: 'ev' } }],
    });
    expect(env.SNOWGLOBE_BARE_PDS).toBe('alpha');
    expect(env.SNOWGLOBE_INVITE_PDS).toBe('alpha beta');
    expect(env.SNOWGLOBE_TAKEN.split(' ')).toEqual(expect.arrayContaining(['plc', 'lex-authority', 'alpha', 'regular', 'beta', 'gh', 'ev']));
    expect(render({ ...THREE, pds: [PDS('regular')] }).env.SNOWGLOBE_BARE_PDS).toBe('');
  });

  it('takes a domain from the command line in place of the file\'s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snowglobe-render-'));
    const r = spawnSync('node', [join(ROOT, 'bin/snowglobe.mjs'), 'render', join(ROOT, 'snowglobe.default.yml'), '--out', dir, '--domain', 'other.test'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(envOf(readFileSync(join(dir, 'globe.env'), 'utf8')).DEVNET_DOMAIN).toBe('other.test');
    expect(readFileSync(join(dir, 'leaf-names'), 'utf8')).toContain('alpha.other.test');
  });

  const docker = spawnSync('docker', ['compose', 'version']).status === 0;
  it.skipIf(!docker)('writes a compose file that docker compose reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snowglobe-render-'));
    const r = spawnSync('node', [join(ROOT, 'bin/snowglobe.mjs'), 'render', join(ROOT, 'snowglobe.default.yml'), '--out', dir], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const c = spawnSync('docker', ['compose', '-p', 'snowglobe-render-test', '--project-directory', ROOT, '-f', join(dir, 'compose.yml'), 'config', '-q'], { encoding: 'utf8' });
    expect(c.status, c.stderr).toBe(0);
  });
});
