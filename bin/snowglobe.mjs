#!/usr/bin/env node
// snowglobe: run the globe a snowglobe.yml describes.
//
//   check     checks a snowglobe.yml
//   render    writes the https globe it describes into its state folder
//   certs     makes your CA, once, and the leaf nginx serves
//   trust     puts your CA in the system and browser trust stores (--remove takes it out)
//   account   makes an account on a PDS in the running globe
//   invite    mints an invite code on one of its PDSes
//   lexicons  publishes lexicons into its lexicon authority
//   app       routes https://<name>.devnet.internal to a port on this machine
//   up        brings the globe up, as the compose project named for its file
//   down      stops it
//   run       runs a command that reaches the globe at the real network's names
//
// A snowglobe is the snowglobe.yml in the folder you are in or the nearest one above (else
// SG_FILE, else the default). Its state is kept per user, not in a checkout: ~/.local/share/
// snowglobe/<globe>/ (XDG_DATA_HOME, %LOCALAPPDATA% on Windows), and its compose project is the
// file's `globe:` unless SG_PROJECT is set (lib/state.mjs).
//
// Each command is a file in lib/commands/, which says what it does and why; the usage below comes
// from them. Exit 2 for a usage mistake, 1 when the globe refuses, 3 when up or down refuse the
// shared devnet; certs keeps 1 for --check's answer, so it fails with 2, and run exits with its
// command's code.

import { readArgs } from '../lib/args.mjs';
import { Refused, UsageError, adoptOldNames } from '../lib/env.mjs';

// Loaded when it runs, so check and render do without the certificate library.
const COMMANDS = {
  check: () => import('../lib/commands/check.mjs'),
  render: () => import('../lib/commands/render.mjs'),
  certs: () => import('../lib/commands/certs.mjs'),
  trust: () => import('../lib/commands/trust.mjs'),
  account: () => import('../lib/commands/account.mjs'),
  invite: () => import('../lib/commands/invite.mjs'),
  lexicons: () => import('../lib/commands/lexicons.mjs'),
  app: () => import('../lib/commands/app.mjs'),
  up: () => import('../lib/commands/up.mjs'),
  down: () => import('../lib/commands/down.mjs'),
  run: () => import('../lib/commands/run.mjs'),
};

const [name, ...args] = process.argv.slice(2);
const mod = Object.hasOwn(COMMANDS, name ?? '') ? await COMMANDS[name]() : null;
// A command that takes any words reads them itself.
const parsed = mod && (mod.command.parse ? mod.command.parse(args) : readArgs(mod.command, args));
if (!parsed) {
  const lines = await Promise.all(Object.values(COMMANDS).map(async (load) => `bin/snowglobe.mjs ${(await load()).command.usage}`));
  console.error(`Usage: ${lines.join('\n       ')}`);
  process.exit(2);
}
// DEVNET_* and SNOWGLOBE_* settings, the old names, become SG_* before any command reads them.
adoptOldNames();
try {
  process.exit((await mod.run(parsed)) ?? 0);
} catch (e) {
  console.error(`snowglobe ${mod.command.name}: ${e.message}`);
  process.exit(e instanceof Refused ? e.exitCode : e instanceof UsageError ? 2 : 1);
}
