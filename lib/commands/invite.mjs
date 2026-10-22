// bin/snowglobe.mjs invite <VAR> [<file>] [--pds <pds>]
//
// invite mints an invite code, INVITE_USES uses (100), on a PDS with invites: required (the only
// one, unless --pds names it) and writes <VAR>=<code> to <file> (accounts.env in the snowglobe's state folder).
// SG_PDS_ADMIN_PASSWORD as the globe was started with. It reads the rendered globe, and
// prints no secret (lib/xrpc.mjs).

import { ROOT, UsageError, envPut, globeFacts, loginsFile, paths } from '../env.mjs';
import { session } from '../state.mjs';
import { mintInvite } from '../xrpc.mjs';

export const command = {
  name: 'invite',
  usage: 'invite <VAR> [<file>] [--pds <pds>]',
  options: { pds: { type: 'string' } },
  positionals: [1, 2],
};

export async function run({ values, positionals: [variable, file] }) {
  await invite({ variable, file, pds: values.pds, state: session().state, log: (m) => console.error(m) });
}

/**
 * Mint an invite code on `pds`, a PDS of the globe that takes them (the only one, by default),
 * with INVITE_USES uses (100 by default), and keep it as <variable>=<code> in `file`
 * (accounts.env in the snowglobe's state folder by default). The code is never printed.
 */
export async function invite({ variable, pds, file, root = ROOT, state, env = process.env, log = () => {} }) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(variable ?? '')) throw new UsageError(`<VAR> must be an env var name (A-Z, 0-9, _): ${variable}`);
  const uses = env.INVITE_USES ?? '100';
  if (!/^[1-9][0-9]*$/.test(uses)) throw new UsageError('INVITE_USES must be a positive number');
  const g = globeFacts({ root, state, env });
  let where = pds;
  if (!where) {
    if (g.invites.length !== 1)
      throw new UsageError(
        g.invites.length
          ? `more than one PDS takes invite codes (${g.invites.join(', ')}); name one with --pds`
          : 'no PDS in this globe takes invite codes (invites: required)',
      );
    where = g.invites[0];
  } else if (!g.pds.includes(where)) throw new UsageError(`${where} is not a PDS in this globe (${g.pds.join(', ')})`);
  else if (!g.invites.includes(where)) throw new UsageError(`${where} takes no invite codes (its invites are open)`);
  const code = await mintInvite(`https://${where}.${g.domain}`, Number(uses), { root, state, env });
  const target = loginsFile(file || paths(root, state).accounts);
  envPut(target, new RegExp(`^${variable}=`), [`${variable}=${code}`]);
  log(`Wrote ${variable} to ${target}: an invite code for ${where}, ${uses} uses`);
}
