// bin/snowglobe.mjs render [<file>] [--out <dir>] [--domain <domain>]
//
// render checks the file as check does (exit 1 with one line per problem), then writes the https
// globe it describes into <dir> (data/globe/ by default): compose.yml, nginx's servers, the leaf
// certificate's names and globe.env, the facts the https-* scripts read (lib/render.mjs). Nothing
// in them is secret. --domain replaces the file's domain, for a copy beside another globe.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT } from '../env.mjs';
import { loadBase, renderGlobe } from '../render.mjs';
import { checkedGlobe } from './check.mjs';

export const command = {
  name: 'render',
  usage: 'render [<file>] [--out <dir>] [--domain <domain>]',
  options: { out: { type: 'string' }, domain: { type: 'string' } },
  positionals: [0, 1],
};

export function run({ values, positionals }) {
  const { path, globe } = checkedGlobe(positionals[0], { domain: values.domain });
  if (!globe) return 1;

  // The compose file mounts nginx's part of the output, by a path from the repo root, which is
  // the compose project directory (scripts/https-lib.sh).
  const out = resolve(values.out ?? join(ROOT, 'data/globe'));
  const rel = relative(ROOT, out);
  const globeDir = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : out;
  const files = renderGlobe(globe, loadBase(ROOT), { globeDir, source: basename(path) });
  for (const [name, text] of Object.entries(files)) {
    const target = join(out, name);
    mkdirSync(dirname(target), { recursive: true });
    // Written aside and renamed, so nothing reads half a file.
    writeFileSync(`${target}.tmp`, text);
    renameSync(`${target}.tmp`, target);
  }
  console.log(`${path}: wrote ${out}: globe ${globe.globe} at ${globe.domain}, PDSs ${globe.pds.map((p) => p.name).join(' ')}`);
  return 0;
}
