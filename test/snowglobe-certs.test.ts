// snowglobe certs (scripts/snowglobe-certs.mjs): the globe's CA and leaf, made in Node. No Docker
// needed; run them alone with `npx vitest run snowglobe-certs`. Where openssl is installed, it
// checks the result as a second opinion and makes a CA the way the old scripts/https-ca.sh did;
// those cases are skipped without it. The CLI runs on a copy of scripts/ in a temporary root.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { ensureCerts, leafLacks, leafNames } from '../scripts/snowglobe-certs.mjs';
// @ts-expect-error: a plain .mjs module, without types
import { devnetRequest, paths } from '../scripts/snowglobe-env.mjs';

const ROOT = join(__dirname, '..');
const D = 'certs.test';
const NAMES = [D, `alpha.${D}`, `*.${D}`, `regular.${D}`, `*.regular.${D}`, `plc.${D}`, 'plc.directory', '*.devnet.internal'];
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

// A root with scripts/ and a rendered globe's leaf-names, as https-up.sh leaves it.
function globeRoot(names = NAMES) {
  const r = mkdtempSync(join(tmpdir(), 'snowglobe-certs-'));
  cpSync(join(ROOT, 'scripts'), join(r, 'scripts'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(r, 'node_modules'));
  writeFileSync(join(r, 'package.json'), '{"type": "module"}\n');
  mkdirSync(join(r, 'data/globe'), { recursive: true });
  writeFileSync(join(r, 'data/globe/globe.env'), `DEVNET_DOMAIN=${D}\n`);
  writeFileSync(join(r, 'data/globe/leaf-names'), names.join('\n') + '\n');
  return r;
}
const certs = (r: string, args: string[] = [], env: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = { ...process.env, ...env };
  delete e.DEVNET_DOMAIN;
  delete e.HTTPS_EXTRA_NAMES;
  Object.assign(e, env);
  return spawnSync('node', [join(r, 'scripts/snowglobe'), 'certs', ...args], { encoding: 'utf8', cwd: r, env: e });
};
const https = (r: string) => join(r, 'data/https');
const cert = (r: string, f: string) => new X509Certificate(readFileSync(join(https(r), f)));
const sans = (c: X509Certificate) => (c.subjectAltName ?? '').split(', ').map((s) => s.replace(/^DNS:/, ''));
const openssl = (...args: string[]) => spawnSync('openssl', args, { encoding: 'utf8' });

// A CA and leaf made with the same openssl commands as the old scripts/https-ca.sh (at 62ee2c2).
function oldScriptCerts(dir: string, names: string[]) {
  mkdirSync(dir, { recursive: true });
  const run = (...args: string[]) => {
    const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  };
  run('req', '-x509', '-new', '-nodes', '-sha256', '-days', '730', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
    '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/O=atproto-devnet/CN=atproto-devnet local CA',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-addext', 'extendedKeyUsage=serverAuth',
    '-addext', `nameConstraints=critical,permitted;DNS:${D},permitted;DNS:devnet.internal,permitted;DNS:plc.directory,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0`);
  writeFileSync(join(dir, 'leaf.ext'), [
    'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=serverAuth',
    'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid,issuer', `subjectAltName=${names.map((n) => `DNS:${n}`).join(',')}`,
  ].join('\n'));
  run('req', '-new', '-nodes', '-sha256', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', `/O=atproto-devnet/CN=${D}`);
  run('x509', '-req', '-sha256', '-days', '397', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-extfile', 'leaf.ext', '-out', 'leaf.crt');
}

describe('snowglobe certs', () => {
  it('makes a CA and a leaf carrying every name, keys at mode 600', () => {
    const r = globeRoot();
    const res = certs(r);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/Made a new CA: O=atproto-devnet, CN=atproto-devnet local CA \d{4}-\d\d-\d\d [0-9a-f]{6}/);
    const ca = cert(r, 'ca.crt');
    const leaf = cert(r, 'leaf.crt');
    expect(ca.ca).toBe(true);
    expect(leaf.checkIssued(ca)).toBe(true);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(sans(leaf).sort()).toEqual([...NAMES].sort());
    expect(leaf.subject).toBe(`O=atproto-devnet\nCN=${D}`);
    for (const f of ['ca.key', 'leaf.key']) expect(statSync(join(https(r), f)).mode & 0o777, f).toBe(0o600);
    for (const f of ['ca.crt', 'leaf.crt']) expect(statSync(join(https(r), f)).mode & 0o777, f).toBe(0o644);
    expect(createPrivateKey(readFileSync(join(https(r), 'leaf.key'))).asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
  });

  it.skipIf(!hasOpenssl)('makes a CA openssl reads as the old one: constrained to the globe, server auth only', () => {
    const r = globeRoot();
    expect(certs(r).status).toBe(0);
    const text = openssl('x509', '-in', join(https(r), 'ca.crt'), '-noout', '-text').stdout;
    expect(text).toMatch(/Basic Constraints: critical\s+CA:TRUE, pathlen:0/);
    expect(text).toMatch(/Key Usage: critical\s+Certificate Sign, CRL Sign/);
    expect(text).toMatch(/Extended Key Usage:\s+TLS Web Server Authentication/);
    expect(text).toMatch(new RegExp(`Name Constraints: critical\\s+Permitted:\\s+DNS:${D}\\s+DNS:devnet.internal\\s+DNS:plc.directory\\s+Excluded:\\s+IP:0.0.0.0/0.0.0.0\\s+IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0`));
    const verify = openssl('verify', '-CAfile', join(https(r), 'ca.crt'), join(https(r), 'leaf.crt'));
    expect(verify.status, verify.stderr).toBe(0);
  });

  it('keeps the CA, and the leaf too when it carries every name', () => {
    const r = globeRoot();
    expect(certs(r).status).toBe(0);
    const ca = cert(r, 'ca.crt').fingerprint256;
    const leaf = cert(r, 'leaf.crt').fingerprint256;
    expect(certs(r, ['--check']).status).toBe(0);
    const again = certs(r);
    expect(again.status).toBe(0);
    expect(again.stderr).toMatch(/Keeping the existing CA/);
    expect(cert(r, 'ca.crt').fingerprint256).toBe(ca);
    expect(cert(r, 'leaf.crt').fingerprint256).toBe(leaf);
  });

  it("reissues the leaf in place when an app claims an ending, from the same CA", () => {
    const r = globeRoot();
    expect(certs(r).status).toBe(0);
    const ca = cert(r, 'ca.crt').fingerprint256;
    const inode = statSync(join(https(r), 'leaf.crt')).ino;
    const keyInode = statSync(join(https(r), 'leaf.key')).ino;
    writeFileSync(join(https(r), 'apps'), 'atmo 5173 ev\nplain 5600\n');
    expect(certs(r, ['--check']).status).toBe(1);
    expect(certs(r).status).toBe(0);
    expect(sans(cert(r, 'leaf.crt'))).toContain(`*.ev.${D}`);
    expect(cert(r, 'ca.crt').fingerprint256).toBe(ca);
    expect(statSync(join(https(r), 'leaf.crt')).ino).toBe(inode);
    expect(statSync(join(https(r), 'leaf.key')).ino).toBe(keyInode);
  });

  it('refuses a name the CA cannot vouch for, and leaves the leaf as it was', () => {
    const r = globeRoot();
    expect(certs(r).status).toBe(0);
    const leaf = cert(r, 'leaf.crt').fingerprint256;
    const res = certs(r, [], { HTTPS_EXTRA_NAMES: 'example.com' });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/cannot vouch for example\.com/);
    expect(cert(r, 'leaf.crt').fingerprint256).toBe(leaf);
  });

  it('refuses when only one of ca.crt and ca.key is there', () => {
    const r = globeRoot();
    mkdirSync(https(r), { recursive: true });
    writeFileSync(join(https(r), 'ca.crt'), 'x');
    const res = certs(r);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/Only one of data\/https\/ca\.crt and ca\.key/);
    expect(existsSync(join(https(r), 'ca.key'))).toBe(false);
  });

  it.skipIf(!hasOpenssl)("keeps a CA and leaf the old https-ca.sh made, and reissues from that CA", () => {
    const r = globeRoot();
    oldScriptCerts(https(r), NAMES);
    const ca = cert(r, 'ca.crt').fingerprint256;
    const leaf = cert(r, 'leaf.crt').fingerprint256;
    expect(certs(r, ['--check']).status).toBe(0);
    expect(certs(r).status).toBe(0);
    expect(cert(r, 'leaf.crt').fingerprint256).toBe(leaf);

    const more = certs(r, [], { HTTPS_EXTRA_NAMES: `x.alpha.${D}` });
    expect(more.status, more.stderr).toBe(0);
    expect(cert(r, 'ca.crt').fingerprint256).toBe(ca);
    expect(cert(r, 'leaf.crt').verify(cert(r, 'ca.crt').publicKey)).toBe(true);
    const verify = openssl('verify', '-CAfile', join(https(r), 'ca.crt'), join(https(r), 'leaf.crt'));
    expect(verify.status, verify.stderr).toBe(0);
  });

  it('leafNames reads the rendered names, app endings and extra names', () => {
    const r = globeRoot();
    mkdirSync(https(r), { recursive: true });
    writeFileSync(join(https(r), 'apps'), 'atmo 5173 ev\nplain 5600\n');
    expect(leafNames(paths(r), D, ' x.alpha.certs.test ')).toEqual([...NAMES, `*.ev.${D}`, `x.alpha.${D}`]);
    expect(leafLacks(https(r), NAMES)).toBe(true);
  });
});

describe('devnetRequest', () => {
  it("reaches a globe name on the bind address, trusting only the globe's CA", async () => {
    const r = globeRoot();
    const names = [...NAMES, `pds.${D}`];
    await ensureCerts({ dir: https(r), domain: D, names });
    const server = createServer(
      { key: readFileSync(join(https(r), 'leaf.key')), cert: readFileSync(join(https(r), 'leaf.crt')) },
      (req, res) => res.end(`hello ${req.headers.host}`),
    );
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    try {
      const ok = await devnetRequest(`https://pds.${D}:${port}/xrpc/_health`, { root: r, env: {} });
      expect(ok).toEqual({ status: 200, body: `hello pds.${D}:${port}` });
      // A name the leaf does not carry fails the TLS check.
      await expect(devnetRequest(`https://other.example:${port}/`, { root: r, env: {} })).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
