// What snowglobe up decides without Docker: whether the globe's PDSes clash with an app's handle
// ending, and data/devnet.env, the globe's own facts for an app to source. Pure: inputs in, text
// out (lib/commands/up.mjs runs the globe).

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
  const v = name.toUpperCase().replace(/-/g, '_');
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
