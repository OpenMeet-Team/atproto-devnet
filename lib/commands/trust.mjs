// bin/snowglobe.mjs trust [--remove] [--dry-run] [--no-sudo]
//
// trust puts your snowglobe CA (one per user, <state root>/ca/ca.crt, made by certs or up) where a
// browser or program looks for the CAs it trusts, so https://local.snowglobe.at opens without a
// warning: the system store and the NSS databases Chrome, Edge and Firefox use on Linux; on WSL
// also the Windows store, whose command it prints for PowerShell; the login keychain on macOS; the
// user store on Windows (lib/trust.mjs). Every command is printed as it runs, and the ones that
// need sudo are marked. Running it again adds nothing. --remove takes the CA out of all of them.
// --dry-run prints what it would run and changes nothing. --no-sudo skips the steps that need sudo
// and prints them for you. The CA is limited to the snowglobe's names (lib/certs.mjs), so trusting
// it does not let it vouch for other sites.
//
// Exit 0 when every step is done or in place, 1 when one could not be (a tool is missing, a command
// failed, sudo skipped), 2 when there is no CA yet. Steps left for you to run (Windows from WSL,
// Firefox on macOS) do not change the exit code.

import { existsSync } from 'node:fs';
import { stateRoot } from '../env.mjs';
import { join } from 'node:path';

export const command = {
  name: 'trust',
  usage: 'trust [--remove] [--dry-run] [--no-sudo]',
  options: { remove: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'no-sudo': { type: 'boolean' } },
  positionals: [0, 0],
  // Each flag once at most.
  accepts: ({ tokens }) => new Set(tokens.filter((t) => t.kind === 'option').map((t) => t.name)).size === tokens.length,
};

export async function run({ values }, { ctx } = {}) {
  const { applySteps, realContext, trustSteps } = await import('../trust.mjs');
  const ca = join(stateRoot(), 'ca', 'ca.crt');
  if (!existsSync(ca)) {
    console.error(`snowglobe trust: no CA at ${ca}. Run snowglobe up (or snowglobe certs) first, which makes it`);
    return 2;
  }
  const c = ctx ?? realContext();
  const remove = Boolean(values.remove);
  console.log(`${remove ? 'Removing' : 'Trusting'} ${ca}${values['dry-run'] ? ' (dry run: nothing is changed)' : ''}`);
  const r = applySteps(trustSteps(ca, c), { remove, dryRun: Boolean(values['dry-run']), noSudo: Boolean(values['no-sudo']), ctx: c });
  console.log(r.failed ? `${r.failed} step(s) not done.` : 'Done.');
  if (r.manual) console.log(`${r.manual} step(s) are for you to run, as printed above.`);
  if (!remove && !r.failed) console.log('Restart a browser that is open for it to see the CA.');
  return r.failed ? 1 : 0;
}
