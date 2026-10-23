// XRPC calls to the globe's PDSes, for what an app makes on the https globe for itself: accounts
// (snowglobe account), invite codes (snowglobe invite) and lexicons in the globe's lexicon
// authority (snowglobe lexicons), each in lib/commands/. Each keeps its logins in a private env
// file, prints only what an app reads (a DID, an NSID) on stdout, and nothing secret anywhere: a
// password or code goes only to the file and to the PDS, in a request body, and an admin login or
// access token only in a request header.

import { snowglobeRequest, setting } from './env.mjs';

// An XRPC call. Resolves to { ok, status, json } (json {} when the answer is not JSON).
export async function xrpc(base, nsid, { body, query, auth, root, state, env }) {
  const url = new URL(`/xrpc/${nsid}`, base);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const headers = {};
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await snowglobeRequest(url.href, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    root,
    state,
    env,
  });
  let json = {};
  try {
    json = JSON.parse(res.body);
  } catch {}
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
}

// What a PDS said when it refused: its error name and message, never the rest of the answer.
export const why = ({ status, json }) => [json.error, json.message].filter(Boolean).join(' ') || `HTTP ${status}`;

const adminAuth = (root, env) =>
  `Basic ${Buffer.from(`admin:${setting('SG_PDS_ADMIN_PASSWORD', { root, env }) || 'snowglobe-admin-password'}`).toString('base64')}`;

// An invite code from a PDS's admin API.
export async function mintInvite(pdsUrl, useCount, { root, state, env }) {
  const res = await xrpc(pdsUrl, 'com.atproto.server.createInviteCode', { body: { useCount }, auth: adminAuth(root, env), root, state, env });
  if (!res.ok || typeof res.json.code !== 'string') throw new Error(`createInviteCode on ${pdsUrl} failed: ${why(res)}`);
  return res.json.code;
}

