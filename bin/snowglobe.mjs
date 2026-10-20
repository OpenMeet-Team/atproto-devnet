#!/usr/bin/env node
// snowglobe: run the globe a snowglobe.yml describes.
//
//   check     checks a snowglobe.yml
//   render    writes the https globe it describes into data/globe/
//   certs     makes the globe's CA and the leaf nginx serves
//   account   makes an account on a PDS in the running globe
//   invite    mints an invite code on one of its PDSes
//   lexicons  publishes lexicons into its lexicon authority
//   app       routes https://<name>.devnet.internal to a port on this machine
//
// Each command is a file in lib/commands/, which says what it does and why; the usage below comes
// from them. Exit 2 for a usage mistake, 1 when the globe refuses; certs keeps 1 for --check's
// answer, so it fails with 2.

import { readArgs } from '../lib/args.mjs';
import { UsageError } from '../lib/env.mjs';

// Loaded when it runs, so check and render do without the certificate library.
const COMMANDS = {
  check: () => import('../lib/commands/check.mjs'),
  render: () => import('../lib/commands/render.mjs'),
  certs: () => import('../lib/commands/certs.mjs'),
  account: () => import('../lib/commands/account.mjs'),
  invite: () => import('../lib/commands/invite.mjs'),
  lexicons: () => import('../lib/commands/lexicons.mjs'),
  app: () => import('../lib/commands/app.mjs'),
};

const [name, ...args] = process.argv.slice(2);
const mod = Object.hasOwn(COMMANDS, name ?? '') ? await COMMANDS[name]() : null;
const parsed = mod && readArgs(mod.command, args);
if (!parsed) {
  const lines = await Promise.all(Object.values(COMMANDS).map(async (load) => `bin/snowglobe.mjs ${(await load()).command.usage}`));
  console.error(`Usage: ${lines.join('\n       ')}`);
  process.exit(2);
}
try {
  process.exit((await mod.run(parsed)) ?? 0);
} catch (e) {
  console.error(`snowglobe ${mod.command.name}: ${e.message}`);
  process.exit(e instanceof UsageError ? 2 : 1);
}
