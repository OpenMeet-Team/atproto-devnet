// bin/snowglobe.mjs down [<file> | <name>] [-f <file>] [-v]
//
// down stops the compose project of the snowglobe in this folder (or above, see lib/state.mjs;
// SG_PROJECT if set), or of the one it is pointed at: a file (<file> or -f <file>), or a name
// from snowglobe ls, which works even when the file that last brought it up is gone, on the globe up last rendered (globe/ in its state folder), and a service an
// earlier render ran and this one does not with it.
//   -v  also drop the project's volumes: every account, DID and record is gone. The PLC's
//       database is a named volume, so without -v the DIDs survive with the PDSes.
//
// The state folder is never deleted. After -v, the next up starts over: the base init reseeds
// alice and bob and rewrites accounts.env from scratch, dropping the logins the tools wrote there
// (their accounts are gone too), and the lexicon authority is made again. The fixed secrets an
// older snowglobe kept for its data (secrets.env) are dropped with it, so up makes random ones. The CA, the leaf and
// the app routes stay either way. The project is guarded as up guards it.

import { ROOT, dc, dropLegacySecrets, guardProject } from '../env.mjs';
import { byName, pointedAt, session } from '../state.mjs';

export const command = {
  name: 'down',
  usage: 'down [<file> | <name>] [-f <file>] [-v]',
  options: { volumes: { type: 'boolean', short: 'v' }, file: { type: 'string', short: 'f' } },
  positionals: [0, 1],
};

export function run({ values, positionals: [word] }) {
  return down({ volumes: values.volumes, ...pointedAt({ file: values.file, word }) });
}

export function down({ volumes = false, file, name, root = ROOT, env = process.env } = {}) {
  // The shared devnet is refused before anything is looked up, even by a file that is not there.
  if (env.SG_PROJECT) guardProject(env);
  const found = name ? byName(name, { env }) : session({ file, env });
  const project = guardProject(env, found.name);
  const res = dc(project, ['down', '--remove-orphans', ...(volumes ? ['-v'] : [])], { root, state: found.state, env });
  if (res.error) throw res.error;
  // The data the fixed secrets were kept for is gone only once compose says it removed it.
  if (volumes && res.status === 0) dropLegacySecrets({ root, state: found.state });
  return res.status ?? 1;
}
