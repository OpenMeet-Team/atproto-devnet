// bin/snowglobe.mjs down [-v]
//
// down stops the compose project of the snowglobe in this folder (or above, see lib/state.mjs;
// SG_PROJECT if set), on the globe up last rendered (globe/ in its state folder), and a service an
// earlier render ran and this one does not with it.
//   -v  also drop the project's volumes: every account, DID and record is gone. The PLC's
//       database is a named volume, so without -v the DIDs survive with the PDSes.
//
// The state folder is never deleted. After -v, the next up starts over: the base init reseeds
// alice and bob and rewrites accounts.env from scratch, dropping the logins the tools wrote there
// (their accounts are gone too), and the lexicon authority is made again. The CA, the leaf and
// the app routes stay either way. The project is guarded as up guards it.

import { ROOT, dc, guardProject } from '../env.mjs';
import { session } from '../state.mjs';

export const command = {
  name: 'down',
  usage: 'down [-v]',
  options: { volumes: { type: 'boolean', short: 'v' } },
  positionals: [0, 0],
  accepts: ({ tokens }) => tokens.length <= 1,
};

export function run({ values }) {
  return down({ volumes: values.volumes });
}

export function down({ volumes = false, file, root = ROOT, env = process.env } = {}) {
  // The shared devnet is refused before anything is looked up, even by a file that is not there.
  if (env.SG_PROJECT) guardProject(env);
  const found = session({ file, env });
  const project = guardProject(env, found.name);
  const res = dc(project, ['down', '--remove-orphans', ...(volumes ? ['-v'] : [])], { root, state: found.state, env });
  if (res.error) throw res.error;
  return res.status ?? 1;
}
