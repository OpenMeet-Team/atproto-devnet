// What an app makes on the https globe for itself: accounts (snowglobe account), invite codes
// (snowglobe invite) and lexicons in the globe's lexicon authority (snowglobe lexicons). Each
// keeps its logins in a private env file, prints only what an app reads (a DID, an NSID) on
// stdout, and nothing secret anywhere: a password or code goes only to the file and to the PDS,
// in a request body, and an admin login or access token only in a request header.

import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, addName, devnetRequest, envGet, envPut, globeFacts, makePrivate, paths, setting } from './snowglobe-env.mjs';

// A mistake in how the command was called, as opposed to one the globe answered with.
export class UsageError extends Error {}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const NSID_RE = /^[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?){2,}$/;
// The authority's own account, which https-up.sh makes under this prefix. Its name is one the
// globe keeps for itself, so no other account takes it.
const AUTHORITY = { name: 'lex-authority', prefix: 'LEX_AUTHORITY' };

// An XRPC call. Resolves to { ok, status, json } (json {} when the answer is not JSON).
async function xrpc(base, nsid, { body, query, auth, root, env }) {
  const url = new URL(`/xrpc/${nsid}`, base);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const headers = {};
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await devnetRequest(url.href, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    root,
    env,
  });
  let json = {};
  try {
    json = JSON.parse(res.body);
  } catch {}
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
}

// What a PDS said when it refused: its error name and message, never the rest of the answer.
const why = ({ status, json }) => [json.error, json.message].filter(Boolean).join(' ') || `HTTP ${status}`;

// The env file for logins: made if missing, and private either way.
function loginsFile(file) {
  if (!existsSync(file)) envPut(file, /^$/);
  makePrivate(file);
  return file;
}

const adminAuth = (root, env) =>
  `Basic ${Buffer.from(`admin:${setting('DEVNET_PDS_ADMIN_PASSWORD', { root, env }) || 'devnet-admin-password'}`).toString('base64')}`;

// An invite code from a PDS's admin API.
async function mintInvite(pdsUrl, useCount, { root, env }) {
  const res = await xrpc(pdsUrl, 'com.atproto.server.createInviteCode', { body: { useCount }, auth: adminAuth(root, env), root, env });
  if (!res.ok || typeof res.json.code !== 'string') throw new Error(`createInviteCode on ${pdsUrl} failed: ${why(res)}`);
  return res.json.code;
}

/**
 * Create, or find, the account <name> on the globe's PDS `pds` (the one with bare handles, else
 * the seed PDS, by default), and keep its login in `file` as <prefix>_HANDLE, _DID, _PASSWORD and
 * _PDS. Its handle is added to the names https-run maps. Resolves to the DID. A rerun signs in
 * with the kept password and finds the account; a PDS that takes invite codes is sent one
 * (DEVNET_INVITE_CODE, else a single-use code minted for this account), the others none.
 */
export async function account({ name, prefix, pds, file, root = ROOT, env = process.env, log = () => {} }) {
  if (!LABEL_RE.test(name ?? '')) throw new UsageError(`<name> must be one lowercase DNS label: ${name}`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(prefix ?? '')) throw new UsageError(`<PREFIX> must be an env var prefix (A-Z, 0-9, _): ${prefix}`);
  const g = globeFacts({ root, env });
  const where = pds || g.bare || g.seed;
  if (!g.pds.includes(where)) throw new UsageError(`${where} is not a PDS in this globe (${g.pds.join(', ')})`);
  const bare = where === g.bare;
  const handle = bare ? `${name}.${g.domain}` : `${name}.${where}.${g.domain}`;
  // A bare handle is <name>.<domain>, the same space as the globe's own names.
  if (bare && g.taken.includes(name) && !(name === AUTHORITY.name && prefix === AUTHORITY.prefix))
    throw new UsageError(`${handle} is a name the globe uses itself; pick another <name>`);
  if (handle.length > 253) throw new UsageError(`${handle} is longer than 253 characters`);
  const pdsUrl = `https://${where}.${g.domain}`;
  const accounts = loginsFile(file || env.ACCOUNTS_FILE || paths(root).accounts);
  const opts = { root, env };

  const save = (did, password) =>
    envPut(accounts, new RegExp(`^${prefix}_(HANDLE|DID|PASSWORD|PDS)=`), [
      `${prefix}_HANDLE=${handle}`,
      `${prefix}_DID=${did}`,
      `${prefix}_PASSWORD=${password}`,
      `${prefix}_PDS=${pdsUrl}`,
    ]);

  const kept = envGet(`${prefix}_PASSWORD`, accounts);
  if (kept && envGet(`${prefix}_HANDLE`, accounts) === handle) {
    const res = await xrpc(pdsUrl, 'com.atproto.server.createSession', { body: { identifier: handle, password: kept }, ...opts });
    if (res.ok && typeof res.json.did === 'string') {
      if (envGet(`${prefix}_DID`, accounts) !== res.json.did) save(res.json.did, kept);
      addName(handle, { root });
      log(`Found ${handle} -> ${res.json.did}`);
      return res.json.did;
    }
    log(`${handle} is in ${accounts} but cannot sign in; creating it`);
  }

  let inviteCode;
  if (g.invites.includes(where)) inviteCode = env.DEVNET_INVITE_CODE || (await mintInvite(pdsUrl, 1, opts));
  const password = randomBytes(16).toString('hex');
  const body = { handle, email: `${name}@${bare ? g.domain : `${where}.${g.domain}`}`, password };
  if (inviteCode) body.inviteCode = inviteCode;
  const res = await xrpc(pdsUrl, 'com.atproto.server.createAccount', { body, ...opts });
  if (!res.ok || typeof res.json.did !== 'string') throw new Error(`createAccount ${handle} on ${pdsUrl} failed: ${why(res)}`);
  save(res.json.did, password);
  addName(handle, { root });
  log(`Created ${handle} on ${pdsUrl} -> ${res.json.did}`);
  return res.json.did;
}

/**
 * Mint an invite code on `pds`, a PDS of the globe that takes them (the only one, by default),
 * with INVITE_USES uses (100 by default), and keep it as <variable>=<code> in `file`
 * (data/accounts.env by default). The code is never printed.
 */
export async function invite({ variable, pds, file, root = ROOT, env = process.env, log = () => {} }) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(variable ?? '')) throw new UsageError(`<VAR> must be an env var name (A-Z, 0-9, _): ${variable}`);
  const uses = env.INVITE_USES ?? '100';
  if (!/^[1-9][0-9]*$/.test(uses)) throw new UsageError('INVITE_USES must be a positive number');
  const g = globeFacts({ root, env });
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
  const code = await mintInvite(`https://${where}.${g.domain}`, Number(uses), { root, env });
  const target = loginsFile(file || paths(root).accounts);
  envPut(target, new RegExp(`^${variable}=`), [`${variable}=${code}`]);
  log(`Wrote ${variable} to ${target}: an invite code for ${where}, ${uses} uses`);
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
 * is LEX_AUTHORITY_* in ACCOUNTS_FILE, else data/accounts.env, which https-up.sh writes. With
 * DEVNET_PUBLIC=1 the authority's PDS is a public name (a globe on the cluster).
 */
export async function lexicons({ dir, root = ROOT, env = process.env, log = () => {}, out = () => {} }) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`no folder ${dir}`);
  const accounts = env.ACCOUNTS_FILE || paths(root).accounts;
  const did = envGet('LEX_AUTHORITY_DID', accounts);
  const pdsUrl = envGet('LEX_AUTHORITY_PDS', accounts);
  const password = envGet('LEX_AUTHORITY_PASSWORD', accounts);
  if (!did || !pdsUrl || !password) throw new Error(`no LEX_AUTHORITY_* login in ${accounts}; run scripts/https-up.sh`);
  const opts = { root, env };

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
