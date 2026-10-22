// bin/snowglobe.mjs lexicons <dir>
//
// lexicons publishes every lexicon document under <dir> into the lexicon authority
// (LEX_AUTHORITY_* in ACCOUNTS_FILE), leaving one that holds the same document alone, and prints
// each NSID. SG_PUBLIC=1 for a globe on the cluster, with ACCOUNTS_FILE its operator logins.
// It prints no secret (lib/xrpc.mjs).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, UsageError, envGet, paths } from '../env.mjs';
import { session } from '../state.mjs';
import { why, xrpc } from '../xrpc.mjs';

const NSID_RE = /^[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?){2,}$/;

export const command = {
  name: 'lexicons',
  usage: 'lexicons <dir>',
  options: {},
  positionals: [1, 1],
};

export async function run({ positionals: [dir] }) {
  await lexicons({ dir, state: session().state, log: (m) => console.error(m), out: (nsid) => console.log(nsid) });
}

// JSON with its keys sorted at every depth, so two equal documents compare equal as text.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// Every *.json file under dir, at any depth, in byte order of their paths.
function jsonFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(f);
    }
  };
  walk(dir);
  return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/**
 * Publish the lexicons under `dir` (each *.json whose "lexicon" is 1 and whose "id" is an NSID;
 * other JSON is skipped) into the lexicon authority as com.atproto.lexicon.schema records keyed by
 * NSID. A record already holding the same document is left alone. `out` gets each NSID. The login
 * is LEX_AUTHORITY_* in ACCOUNTS_FILE, else accounts.env in the snowglobe's state folder, which snowglobe up writes. With
 * SG_PUBLIC=1 the authority's PDS is a public name (a globe on the cluster).
 */
export async function lexicons({ dir, root = ROOT, state, env = process.env, log = () => {}, out = () => {} }) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`no folder ${dir}`);
  const accounts = env.ACCOUNTS_FILE || paths(root, state).accounts;
  const did = envGet('LEX_AUTHORITY_DID', accounts);
  const pdsUrl = envGet('LEX_AUTHORITY_PDS', accounts);
  const password = envGet('LEX_AUTHORITY_PASSWORD', accounts);
  if (!did || !pdsUrl || !password) throw new Error(`no LEX_AUTHORITY_* login in ${accounts}; run bin/snowglobe.mjs up`);
  const opts = { root, state, env };

  const session = await xrpc(pdsUrl, 'com.atproto.server.createSession', { body: { identifier: did, password }, ...opts });
  if (!session.ok || typeof session.json.accessJwt !== 'string') throw new Error(`the authority cannot sign in: ${why(session)}`);
  const auth = `Bearer ${session.json.accessJwt}`;

  const n = { published: 0, unchanged: 0, skipped: 0 };
  for (const f of jsonFiles(dir)) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(f, 'utf8'));
    } catch {}
    const nsid = doc?.lexicon === 1 && typeof doc.id === 'string' ? doc.id : '';
    if (!NSID_RE.test(nsid)) {
      log(`skipped (not a lexicon document): ${f}`);
      n.skipped++;
      continue;
    }
    const record = { ...doc, $type: 'com.atproto.lexicon.schema' };
    const key = { repo: did, collection: 'com.atproto.lexicon.schema', rkey: nsid };
    const current = await xrpc(pdsUrl, 'com.atproto.repo.getRecord', { query: key, ...opts });
    if (current.ok && current.json.value && canonical(current.json.value) === canonical(record)) n.unchanged++;
    else {
      const put = await xrpc(pdsUrl, 'com.atproto.repo.putRecord', { body: { ...key, record }, auth, ...opts });
      if (!put.ok || typeof put.json.uri !== 'string') throw new Error(`putRecord ${nsid} failed: ${why(put)}`);
      n.published++;
    }
    out(nsid);
  }
  log(`Authority ${did}: ${n.published} published, ${n.unchanged} unchanged, ${n.skipped} skipped`);
  return n;
}
