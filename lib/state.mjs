// Which snowglobe a command acts on, and where its state is: the snowglobe.yml in the folder you
// are in or the nearest one above (else SG_FILE, else the default globe at the repo root), the
// `globe:` name in it, and from that name the state folder (<state root>/<name>, lib/env.mjs
// stateRoot) and the compose project (the same name, unless SG_PROJECT is set). The state
// folder records which file owns it, so two files that say `globe: t1` cannot share one folder,
// or one compose project.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { globeName } from './config.mjs';
import { ROOT, stateRoot } from './env.mjs';

/**
 * The file a command reads when it is given none: SG_FILE, else ./snowglobe.yml, else the first
 * snowglobe.yml in a folder above this one, else the default globe at the repo root. A file in
 * the folder itself is named as 'snowglobe.yml'; one above, by its absolute path.
 */
export function findFile({ file, env = process.env, cwd = process.cwd() } = {}) {
  if (file) return file;
  if (env.SG_FILE) return env.SG_FILE;
  const here = resolve(cwd);
  for (let dir = here; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'snowglobe.yml'))) return dir === here ? 'snowglobe.yml' : join(dir, 'snowglobe.yml');
    if (dirname(dir) === dir) break;
  }
  return join(ROOT, 'snowglobe.default.yml');
}

// The file that owns a state folder is recorded here, as an absolute path.
const OWNER = 'owner';

/**
 * Refuse a state folder whose recorded owner is another file that still exists. With `claim`, a
 * folder with no owner, or whose owner is gone (moved or deleted), is recorded as this file's.
 */
function owned({ name, state }, file, claim) {
  const mine = realpathSync(resolve(file));
  const record = join(state, OWNER);
  const first = existsSync(record) ? readFileSync(record, 'utf8').trim() : '';
  if (first && first !== mine && existsSync(first))
    throw new Error(
      `the snowglobe ${name} belongs to ${first} (its state is in ${state}), and ${mine} also says globe: ${name}. ` +
        `Give one of them another name in its globe: line, or delete ${record} to hand ${name} to the second file`,
    );
  if (claim && first !== mine) {
    mkdirSync(state, { recursive: true });
    writeFileSync(record, `${mine}\n`);
  }
}

/**
 * The snowglobe a command acts on: { path (as given, or found), name, state, project }. Throws
 * when the file has no usable `globe:` name or another file owns that name's state. `claim`
 * records this file as the owner (up and render do, once the file checks out; the commands that
 * only use a snowglobe do not).
 */
export function session({ file, env = process.env, cwd = process.cwd(), claim = false } = {}) {
  const path = findFile({ file, env, cwd });
  const name = globeName(resolve(path));
  const found = { path, name, state: join(stateRoot(env), name), project: env.SG_PROJECT || name };
  owned(found, path, claim);
  return found;
}

/** Record the session's file as the owner of its state folder (made if need be). */
export const claimState = (found) => owned(found, found.path, true);
