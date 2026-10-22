// bin/snowglobe.mjs certs [--check]
//
// certs makes the CA if there is none (one per user, kept in the state root's ca/ folder, so it is
// trusted once for every snowglobe), and issues the leaf nginx serves when it lacks one of the
// rendered globe's names, or another CA signed it (lib/certs.mjs). --check only says whether it would: exit 0 when
// the leaf carries every name, 1 when it lacks one. HTTPS_EXTRA_NAMES adds names
// (space-separated), on every run. Any failure exits 2, since 1 is --check's answer.

import { ROOT, paths, resolveDomain } from '../env.mjs';
import { session } from '../state.mjs';

export const command = {
  name: 'certs',
  usage: 'certs [--check]',
  options: { check: { type: 'boolean' } },
  positionals: [0, 0],
  // --check once at most.
  accepts: ({ tokens }) => tokens.length <= 1,
};

export async function run({ values }) {
  try {
    // Loaded here, so the usage, which loads every command, does without the certificate library.
    const { ensureCerts, leafLacks, leafNames } = await import('../certs.mjs');
    const { state } = session();
    const p = paths(ROOT, state);
    const { domain } = resolveDomain({ root: ROOT, state });
    const names = leafNames(p, domain, process.env.HTTPS_EXTRA_NAMES);
    if (values.check) return leafLacks(p.https, names, p.caDir) ? 1 : 0;
    await ensureCerts({ dir: p.https, caDir: p.caDir, domain, names, log: (m) => console.error(m) });
    return 0;
  } catch (e) {
    console.error(`snowglobe certs: ${e.message}`);
    return 2;
  }
}
