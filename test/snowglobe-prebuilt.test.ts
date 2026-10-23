// lib/prebuilt.mjs decides, per published image, between one already here, one pulled from the
// registry, and one the caller builds. Docker is a recording stub, so none of it needs a daemon.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
// @ts-expect-error: a plain .mjs module, without types
import { prebuilt, sourceHash } from '../lib/prebuilt.mjs';

const ROOT = join(__dirname, '..');
const services = {
  slingshot: { build: { context: './stack/slingshot' }, image: 'snowglobe-slingshot:abc' },
  pdsls: { build: './stack/pdsls', image: 'snowglobe-pdsls:def' },
  proxy: { build: './stack/https/proxy', image: 'snowglobe-proxy:ghi' },
  plc: { image: 'itaru2622/bluesky-did-method-plc:latest' },
};

// Local images by ref -> source label; the registry's by ref -> label it would carry once pulled.
function docker(local: Record<string, string>, registry: Record<string, string>) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'image') return args[4] in local ? { status: 0, stdout: `${local[args[4]]}\n` } : { status: 1, stdout: '' };
    if (args[0] === 'pull') return args[2].replace(/^[^/]+\/[^/]+\//, '') in registry ? { status: 0, stdout: '' } : { status: 1, stdout: '' };
    if (args[0] === 'tag') {
      local[args[2]] = registry[args[1].replace(/^[^/]+\/[^/]+\//, '')];
      return { status: 0, stdout: '' };
    }
    return { status: 1, stdout: '' };
  };
  return { run, calls };
}
const sg = sourceHash(ROOT, 'snowglobe-slingshot');
const pd = sourceHash(ROOT, 'snowglobe-pdsls');

describe('prebuilt images', () => {
  it('pulls the published images whose label matches this checkout, and leaves the rest to build', () => {
    const { run } = docker({}, { 'snowglobe-slingshot:abc': sg, 'snowglobe-pdsls:def': 'from-an-older-patch' });
    expect(prebuilt({ root: ROOT, services, run })).toEqual(['slingshot']);
  });

  it('uses an image already here with the right label, without pulling', () => {
    const { run, calls } = docker({ 'snowglobe-slingshot:abc': sg, 'snowglobe-pdsls:def': pd }, {});
    expect(prebuilt({ root: ROOT, services, run })).toEqual(['slingshot', 'pdsls']);
    expect(calls.some((c) => c[0] === 'pull')).toBe(false);
  });

  it('builds an image whose local copy was built from other files, when the registry has none', () => {
    const { run } = docker({ 'snowglobe-slingshot:abc': 'older' }, {});
    expect(prebuilt({ root: ROOT, services, run })).toEqual([]);
  });

  it('never asks about an image snowglobe does not publish', () => {
    const { run, calls } = docker({}, {});
    prebuilt({ root: ROOT, services, run });
    expect(calls.flat().join(' ')).not.toMatch(/snowglobe-proxy|bluesky-did-method-plc/);
  });

  it('pulls nothing with SG_PREBUILT=0, and uses SG_IMAGE_REGISTRY when set', () => {
    const { run, calls } = docker({}, { 'snowglobe-slingshot:abc': sg });
    expect(prebuilt({ root: ROOT, services, run, env: { SG_PREBUILT: '0' } })).toEqual([]);
    expect(calls).toEqual([]);
    prebuilt({ root: ROOT, services, run, env: { SG_IMAGE_REGISTRY: 'mirror.test/sg/' } });
    expect(calls.find((c) => c[0] === 'pull')?.[2]).toBe('mirror.test/sg/snowglobe-slingshot:abc');
  });
});
