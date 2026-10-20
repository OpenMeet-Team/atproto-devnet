// bin/snowglobe.mjs check [<file>]
//
// check checks the file and exits 0 if it is sound, 1 with one line per problem if not
// (lib/config.mjs has the rules). It touches nothing, and needs no Docker.
//
// With no <file>, ./snowglobe.yml if there is one, else the default globe at the repo root
// (snowglobe.default.yml: today's https devnet). render reads its file the same way.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadGlobe } from '../config.mjs';
import { ROOT } from '../env.mjs';

export const command = {
  name: 'check',
  usage: 'check [<file>]',
  options: {},
  positionals: [0, 1],
};

/**
 * Load and check `file` (or the file check reads with none), with `domain` in place of its own
 * when given. Each problem goes to stderr as one line; `globe` is null when there is one.
 */
export function checkedGlobe(file, { domain } = {}) {
  const path = file ?? (existsSync('snowglobe.yml') ? 'snowglobe.yml' : join(ROOT, 'snowglobe.default.yml'));
  const { globe, errors } = loadGlobe(path, { domain });
  for (const e of errors) console.error(`${path}: ${e}`);
  return { path, globe: errors.length ? null : globe };
}

export function run({ positionals }) {
  const { path, globe } = checkedGlobe(positionals[0]);
  if (!globe) return 1;
  const extra = globe.grouphosts.length ? `, ${globe.grouphosts.length} group host(s)` : '';
  console.log(`${path}: ok: globe ${globe.globe} at ${globe.domain}, PDSs ${globe.pds.map((p) => p.name).join(' ')}${extra}`);
  return 0;
}
