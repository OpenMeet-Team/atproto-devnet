// bin/snowglobe.mjs down [-v]
//
// down stops compose project DEVNET_PROJECT, on the globe up last rendered (data/globe/), and a
// service an earlier render ran and this one does not with it.
//   -v  also drop the project's volumes: every account, DID and record is gone. The PLC's
//       database is a named volume, so without -v the DIDs survive with the PDSes.
//
// data/ is never deleted. After -v, the next up starts over: the base init reseeds alice and bob
// and rewrites data/accounts.env from scratch, dropping the logins the tools wrote there (their
// accounts are gone too), and the lexicon authority is made again. The CA, the leaf and the app
// routes in data/https stay either way. The project is guarded as up guards it.

import { ROOT, dc, guardProject } from '../env.mjs';

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

export function down({ volumes = false, root = ROOT, env = process.env } = {}) {
  const project = guardProject(env);
  const res = dc(project, ['down', '--remove-orphans', ...(volumes ? ['-v'] : [])], { root, env });
  if (res.error) throw res.error;
  return res.status ?? 1;
}
