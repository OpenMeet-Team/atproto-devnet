// Which snowglobe a command acts on, and where its state is: the snowglobe.yml in the folder you
// are in or the nearest one above (else SG_FILE, else the default globe at the repo root), the
// `globe:` name in it, and from that name the state folder (<state root>/<name>, lib/env.mjs
// stateRoot) and the compose project (the same name, unless SG_PROJECT is set). The name is the
// snowglobe: every file that says `globe: t1` is the same one (two worktrees of an app share it),
// and the last file to bring it up decides what it runs. The state folder records that file.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { globeName } from './config.mjs';
import { ROOT, stateRoot } from './env.mjs';

/**
 * The file a command reads when it is given none: SG_FILE, else ./snowglobe.yml, else the first
 * snowglobe.yml in a folder above this one, else the default globe at the repo root. A file in
 * the folder itself is named as 'snowglobe.yml'; one above, by its absolute path. With
 * allowDefault false (a command that starts something), finding none is an error.
 */
export function findFile({ file, env = process.env, cwd = process.cwd(), allowDefault = true } = {}) {
  if (file) return file;
  if (env.SG_FILE) return env.SG_FILE;
  const here = resolve(cwd);
  for (let dir = here; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'snowglobe.yml'))) return dir === here ? 'snowglobe.yml' : join(dir, 'snowglobe.yml');
    if (dirname(dir) === dir) break;
  }
  if (!allowDefault)
    throw new Error(
      `no snowglobe.yml in ${here} or any folder above it, and SG_FILE is not set. ` +
        'To run the default snowglobe on purpose: snowglobe up --default',
    );
  return join(ROOT, 'snowglobe.default.yml');
}

// The file that last brought the snowglobe up (or rendered it) is recorded here, as an absolute
// path: ls shows it, and up and down find the file by the snowglobe's name through it. The record
// keeps its first name, owner, so the folders made before keep theirs.
const OWNER = 'owner';

/** The file recorded as last bringing up the snowglobe in `state`, or '' when none is. */
export function ownerOf(state) {
  const record = join(state, OWNER);
  return existsSync(record) ? readFileSync(record, 'utf8').trim() : '';
}

/**
 * The file `up` or `down` was pointed at, from its -f option and its one word, which is a file
 * or the name of a snowglobe (snowglobe ls shows them): { file } for a file, { name } for a
 * snowglobe, {} for neither given (the file found from the folder you are in). A word that is a
 * file that exists is that file; else it is a name when a state folder is called that. Throws
 * when it is neither, or both -f and a word are given.
 */
export function pointedAt({ file, word, env = process.env } = {}) {
  if (file && word) throw new Error(`give the snowglobe once: -f ${file} or ${word}, not both`);
  if (file) return { file };
  if (!word) return {};
  if (existsSync(word) && statSync(word).isFile()) return { file: word };
  if (!/[\\/]/.test(word) && existsSync(join(stateRoot(env), word))) return { name: word };
  throw new Error(`${word} is not a file, and no snowglobe is called that (snowglobe ls lists them)`);
}

/**
 * The snowglobe called `name`, as session returns it, for a command that stops or reads one
 * without its file: `path` is the file that last brought it up, '' when that file is gone. Throws
 * when no state folder has the name.
 */
export function byName(name, { env = process.env } = {}) {
  const state = join(stateRoot(env), name);
  if (!existsSync(state)) throw new Error(`no snowglobe is called ${name} (snowglobe ls lists them)`);
  const owner = ownerOf(state);
  return { path: owner && existsSync(owner) ? owner : '', name, state, project: env.SG_PROJECT || name };
}

/**
 * The snowglobe a command acts on: { path (as given, or found), name, state, project }. Throws
 * when the file has no usable `globe:` name.
 */
export function session({ file, env = process.env, cwd = process.cwd(), allowDefault = true } = {}) {
  const path = findFile({ file, env, cwd, allowDefault });
  const name = globeName(resolve(path));
  return { path, name, state: join(stateRoot(env), name), project: env.SG_PROJECT || name };
}

/**
 * Record the session's file as the one that last brought its snowglobe up (up and render do, once
 * the file checks out), making the state folder if need be. Returns a line to show when another
 * file did before, else null.
 */
export function claimState({ name, state, path }) {
  const mine = realpathSync(resolve(path));
  const before = ownerOf(state);
  if (before === mine) return null;
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, OWNER), `${mine}\n`);
  return before ? `the snowglobe ${name} was last brought up from ${before}; it now runs what ${mine} says` : null;
}
