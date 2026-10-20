// What snowglobe up decides without Docker: the app routes the file adds, whether the globe's
// PDSes clash with an app's handle ending, the env names the file's accounts keep their logins
// under, and data/devnet.env, the globe's own facts for an app to source. Pure: inputs in, text
// or lists out (lib/commands/up.mjs runs the globe).

const envName = (label) => label.toUpperCase().replace(/-/g, '_');

/**
 * The routes in data/https/apps (`routes`) with each app the file runs locally (`fileApps`, the
 * parsed globe's apps) set to the file's port and handle ending. A route the file does not name is
 * kept, as `snowglobe app` made it. Throws when the file's ending is another route's.
 */
export function mergeRoutes(routes, fileApps) {
  const out = [...routes];
  for (const a of fileApps.filter((x) => x.local)) {
    const route = { name: a.name, port: a.local.port, ending: a.local.handles ?? null };
    const owner = route.ending && out.find((r) => r.ending === route.ending && r.name !== a.name);
    if (owner)
      throw new Error(`the file's app ${a.name} claims the handles under ${route.ending}, which already go to ${owner.name} (data/https/apps); bin/snowglobe.mjs app --remove ${owner.name}`);
    const i = out.findIndex((r) => r.name === a.name);
    if (i === -1) out.push(route);
    else out[i] = route;
  }
  return out;
}

/**
 * The file's accounts ({ name, pds }), each with the env prefix its login is kept under in
 * data/accounts.env: <NAME> on `home` (the PDS snowglobe account makes accounts on by default,
 * where the base init's ALICE and BOB are), <NAME>_<PDS> on any other. A shell name cannot start
 * with a digit, so 1st is _1ST. Throws when two accounts would share one.
 */
export function accountPrefixes(accounts, home) {
  const seen = new Map();
  return accounts.map(({ name, pds }) => {
    const v = pds === home ? envName(name) : `${envName(name)}_${envName(pds)}`;
    const prefix = /^[0-9]/.test(v) ? `_${v}` : v;
    if (seen.has(prefix)) throw new Error(`${name}@${pds} and ${seen.get(prefix)} would both keep their logins as ${prefix}_*; rename one`);
    seen.set(prefix, `${name}@${pds}`);
    return { name, pds, prefix };
  });
}

/**
 * The first PDS of `pdsNames` named like the ending an app in `apps` claimed, as { pds, app }, or
 * null. Such a PDS would take that app's handles: nginx keeps the first of two servers with one
 * name, and the globe's come before the apps'.
 */
export function endingClash(pdsNames, apps) {
  for (const pds of pdsNames) {
    const app = apps.find((a) => a.ending === pds);
    if (app) return { pds, app: app.name };
  }
  return null;
}

// <NAME>_PDS_URL's name for a PDS: ALPHA_PDS_URL for alpha. A shell name cannot start with a
// digit, so a PDS named 1st is _1ST_PDS_URL.
export function pdsVar(name) {
  const v = envName(name);
  return `${/^[0-9]/.test(v) ? '_' : ''}${v}_PDS_URL`;
}

/**
 * data/devnet.env: the globe's URLs, the lexicon authority's DID and handle, the CA and the
 * address nginx is on. Nothing secret: logins are in data/accounts.env.
 */
export function devnetEnv({ project, domain, pds, ports, authority, ca, bind }) {
  return [
    '# The https devnet\'s own facts, written by bin/snowglobe.mjs up. Nothing secret:',
    '# logins are in data/accounts.env. Run clients under bin/snowglobe.mjs run.',
    `DEVNET_PROJECT=${project}`,
    `DEVNET_DOMAIN=${domain}`,
    `PAGE_URL=https://${domain}/`,
    ...pds.map((p) => `${pdsVar(p)}=https://${p}.${domain}`),
    'PLC_URL=https://plc.directory',
    `JETSTREAM_URL=ws://127.0.0.1:${ports.jetstream}`,
    `MAILDEV_URL=http://127.0.0.1:${ports.maildev}`,
    `PROXY_PAC_URL=http://127.0.0.1:${ports.proxy}/proxy.pac`,
    `LEX_AUTHORITY_DID=${authority.did}`,
    `LEX_AUTHORITY_HANDLE=${authority.handle}`,
    `DEVNET_CA_FILE=${ca}`,
    `DEVNET_BIND=${bind}`,
    '',
  ].join('\n');
}
