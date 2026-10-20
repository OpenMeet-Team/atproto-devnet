// snowglobe.yml: the one file that says what a globe runs. This reads it, fills in the
// defaults and checks it, without touching Docker. Every error names where in the file
// it is, so a bad file fails before anything starts.
//
// The file's shape and the reasons for each rule: OKF
// projects/atmo-events/2026-10-19-snowglobe-yml-design.md.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

// Images a file may name by a short name. Each is pinned by digest, because the tags
// they come from move.
export const IMAGE_NAMES = {
  // The atproto permissioned-spaces alpha, revision 79d6307e (2026-10-01).
  'spaces-alpha':
    'ghcr.io/bluesky-social/atproto@sha256:1cf9349e9f0e89789784569fed376cd647742ea7c368948625f44779ba03f150',
};

// Kinds of group host, and the image each runs unless the file names another build.
// The image is not settled for a local globe yet (om-r1vrl.31.4), so it is left empty.
export const GROUPHOST_KINDS = { opensocial: null };

// Names the network already uses: under the domain (plc.<domain>, relay.<domain>, ...), as
// compose services the https devnet always runs, and as the page's own /health/<name> routes
// (page/devnet.conf, where TAP is sync). A PDS, group host or bare handle by one of these names
// would take its address, its service or its route.
const RESERVED = [
  'plc', 'relay', 'jetstream', 'slingshot', 'pdsls', 'tap', 'mail', 'lex-authority',
  'pds', 'nginx', 'postgres', 'maildev', 'proxy', 'init', 'relay-init', 'slingshot-dns', 'sync',
];

// The lexicon authority's account, made on its PDS before any account in the file.
const AUTHORITY_ACCOUNT = 'lex-authority';

// Names nginx answers whatever the domain: apps on this machine (https-app.sh) at
// *.devnet.internal, and the stand-in for the real PLC directory at exactly plc.directory.
// A domain that is one, or above one, would share it; so would one under the apps' wildcard.
const FIXED_DOMAINS = [
  { name: 'devnet.internal', wildcard: true },
  { name: 'plc.directory', wildcard: false },
];

const TOP = ['globe', 'domain', 'pds', 'grouphosts', 'services', 'lexicons', 'accounts', 'apps', 'hosted'];
const SERVICES = ['relay', 'jetstream', 'tap', 'slingshot', 'pdsls', 'cdn'];

// The globe's name is a compose project locally and a namespace hosted
// (snowglobe-<globe>), so it keeps k8s/stamp.sh's rule.
const GLOBE_RE = /^[a-z][a-z0-9]{0,30}$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
// The longest a name may be, and so a handle (atproto's handle limit is DNS's).
const NAME_MAX = 253;

// An image reference, after github.com/distribution/reference: [registry/]path[:tag][@digest].
// As there, a first component is a registry when it has a dot, a port or an uppercase letter,
// is localhost, or is a bracketed IPv6 address; path components are lowercase; the name
// (registry and path) is at most 255 characters.
const HOST_C = '[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?';
const REGISTRY_RE = new RegExp(`^(?:${HOST_C}(?:\\.${HOST_C})*|\\[[0-9a-fA-F:.]+\\])(?::[0-9]+)?$`);
const PATH_RE = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_HEX = { sha256: 64, sha384: 96, sha512: 128 };
const IMAGE_NAME_MAX = 255;

/**
 * Read and check a file. Returns { globe, errors }; globe is the filled-in file. A domain
 * given here replaces the file's, before the checks (a copy of a globe beside another).
 */
export function loadGlobe(file, { domain } = {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { globe: null, errors: [`${file}: cannot read it (${e.code ?? e.message})`] };
  }
  let doc;
  try {
    doc = parse(text);
  } catch (e) {
    return { globe: null, errors: [`${file}: not YAML: ${e.message.split('\n')[0]}`] };
  }
  if (domain !== undefined && isMap(doc)) doc.domain = domain;
  return checkGlobe(doc, { baseDir: dirname(resolve(file)) });
}

/**
 * Check a parsed file and fill in its defaults. baseDir is where relative paths in it
 * (lexicons.publish) are found; without it they are not looked up.
 */
export function checkGlobe(doc, { baseDir } = {}) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  if (!isMap(doc)) return { globe: null, errors: ['the file must be a map of settings'] };
  unknownKeys(doc, TOP, '', err);

  // globe, domain
  if (doc.globe === undefined) err('globe', 'required');
  else if (typeof doc.globe !== 'string' || !GLOBE_RE.test(doc.globe))
    err('globe', `${show(doc.globe)} must be lowercase letters and digits, starting with a letter, at most 31`);
  const domain = doc.domain ?? 'devnet.test';
  const domainOk = typeof domain === 'string' && DOMAIN_RE.test(domain) && domain.length <= NAME_MAX;
  if (!domainOk)
    err('domain', `${show(domain)} must be a domain name, such as devnet.test`);
  else {
    const fixed = FIXED_DOMAINS.find(
      ({ name, wildcard }) => name === domain || name.endsWith(`.${domain}`) || (wildcard && domain.endsWith(`.${name}`)),
    );
    if (fixed) err('domain', `"${domain}" overlaps ${fixed.name}, which the network serves whatever the domain`);
  }
  // The domain as names are built from it. A refused domain may not be a string at all, and
  // its error is already reported, so the names below are built on a stand-in.
  const D = domainOk ? domain : '<domain>';
  // A generated name must fit in DNS: <name>.<domain>, and a handle <name>.<pds>.<domain>.
  // A domain already refused would only repeat its error here.
  const fits = (name, where) => {
    if (domainOk && name.length > NAME_MAX) err(where, `${name} is longer than ${NAME_MAX} characters`);
  };
  // The network's own names under the domain, the longest of them first.
  fits(`${[...RESERVED].sort((a, b) => b.length - a.length)[0]}.${D}`, 'domain');

  // Every name that becomes <name>.<domain>, so two of them cannot share one.
  const names = new Map();
  const claim = (name, where) => {
    if (typeof name !== 'string') return;
    fits(`${name}.${D}`, where);
    if (RESERVED.includes(name)) err(where, `"${name}" is taken by the network itself (${name}.${D})`);
    else if (names.has(name)) err(where, `"${name}" is already used by ${names.get(name)}`);
    else names.set(name, where);
  };

  // pds
  const pds = [];
  if (doc.pds === undefined) err('pds', 'required: at least one PDS');
  else if (!Array.isArray(doc.pds) || doc.pds.length === 0) err('pds', 'must be a list of at least one PDS');
  else
    doc.pds.forEach((p, i) => {
      const at = `pds[${i}]`;
      if (!isMap(p)) return err(at, 'must be a map with name and image');
      unknownKeys(p, ['name', 'image', 'bare_handles', 'invites'], at, err);
      label(p.name, `${at}.name`, err);
      claim(p.name, `${at}.name`);
      const image = imageRef(p.image, `${at}.image`, err, { required: true });
      if (p.bare_handles !== undefined && typeof p.bare_handles !== 'boolean')
        err(`${at}.bare_handles`, 'must be true or false');
      const invites = p.invites ?? 'open';
      if (invites !== 'open' && invites !== 'required') err(`${at}.invites`, `${show(invites)} must be open or required`);
      pds.push({ name: p.name, image, bare_handles: p.bare_handles === true, invites });
    });
  const bare = pds.filter((p) => p.bare_handles);
  if (bare.length > 1)
    err('pds', `only one PDS can take bare handles (<name>.${D}); ${bare.map((p) => show(p.name)).join(' and ')} all do`);
  const pdsNames = pds.map((p) => p.name).filter((n) => typeof n === 'string');

  // grouphosts
  const grouphosts = [];
  if (doc.grouphosts !== undefined) {
    if (!Array.isArray(doc.grouphosts)) err('grouphosts', 'must be a list');
    else
      doc.grouphosts.forEach((g, i) => {
        const at = `grouphosts[${i}]`;
        if (!isMap(g)) return err(at, 'must be a map with name and kind');
        unknownKeys(g, ['name', 'kind', 'image'], at, err);
        label(g.name, `${at}.name`, err);
        claim(g.name, `${at}.name`);
        const known = typeof g.kind === 'string' && Object.hasOwn(GROUPHOST_KINDS, g.kind);
        if (!known)
          err(`${at}.kind`, `${show(g.kind)} is not a kind of group host; known: ${Object.keys(GROUPHOST_KINDS).join(', ')}`);
        const image = g.image === undefined ? (known ? GROUPHOST_KINDS[g.kind] : null) : imageRef(g.image, `${at}.image`, err);
        grouphosts.push({ name: g.name, kind: g.kind, image });
      });
  }

  // services
  const services = { relay: 'auto', jetstream: true, tap: true, slingshot: true, pdsls: true, cdn: false };
  if (doc.services !== undefined) {
    if (!isMap(doc.services)) err('services', 'must be a map');
    else {
      unknownKeys(doc.services, SERVICES, 'services', err);
      for (const k of SERVICES) {
        const v = doc.services[k];
        if (v === undefined) continue;
        if (typeof v === 'boolean' || (k === 'relay' && v === 'auto')) services[k] = v;
        else err(`services.${k}`, `must be true or false${k === 'relay' ? ', or auto' : ''}`);
      }
    }
  }
  // Without a relay Jetstream and TAP follow one PDS's own firehose, and the others' writes
  // are seen by nothing.
  if (services.relay === 'auto') services.relay = pds.length > 1;
  else if (services.relay === false && pds.length > 1)
    err('services.relay', 'cannot be off with more than one PDS: only one PDS would be followed');
  // Slingshot reads this network's Jetstream.
  if (services.slingshot && !services.jetstream) err('services.slingshot', 'needs jetstream');

  // lexicons
  const lexicons = { authority: (bare[0] ?? pds[0])?.name, publish: null };
  if (doc.lexicons !== undefined) {
    if (!isMap(doc.lexicons)) err('lexicons', 'must be a map');
    else {
      unknownKeys(doc.lexicons, ['authority', 'publish'], 'lexicons', err);
      if (doc.lexicons.authority !== undefined) {
        if (!pdsNames.includes(doc.lexicons.authority))
          err('lexicons.authority', `${show(doc.lexicons.authority)} is not a PDS in this file (${pdsNames.join(', ')})`);
        lexicons.authority = doc.lexicons.authority;
      }
      if (doc.lexicons.publish !== undefined) {
        if (typeof doc.lexicons.publish !== 'string') err('lexicons.publish', 'must be a folder path');
        else {
          lexicons.publish = doc.lexicons.publish;
          if (baseDir) {
            const dir = resolve(baseDir, doc.lexicons.publish);
            if (!existsSync(dir) || !statSync(dir).isDirectory())
              err('lexicons.publish', `${show(doc.lexicons.publish)} is not a folder next to the file`);
          }
        }
      }
    }
  }

  // The authority's account is made on its PDS like any other, so its handle must fit too.
  const authority = pds.find((p) => p.name === lexicons.authority);
  if (authority)
    fits(authority.bare_handles ? `${AUTHORITY_ACCOUNT}.${D}` : `${AUTHORITY_ACCOUNT}.${authority.name}.${D}`, 'lexicons.authority');

  // apps (before accounts, so a bare handle meets the apps' handle endings)
  const apps = [];
  if (doc.apps !== undefined) {
    if (!Array.isArray(doc.apps)) err('apps', 'must be a list');
    else {
      const appNames = new Set();
      doc.apps.forEach((a, i) => {
        const at = `apps[${i}]`;
        if (!isMap(a)) return err(at, 'must be a map with name');
        unknownKeys(a, ['name', 'local', 'hosted'], at, err);
        label(a.name, `${at}.name`, err);
        if (appNames.has(a.name)) err(`${at}.name`, `${show(a.name)} is listed twice`);
        appNames.add(a.name);
        const app = { name: a.name, local: null, hosted: null };
        if (a.local !== undefined) {
          if (!isMap(a.local)) err(`${at}.local`, 'must be a map with port');
          else {
            unknownKeys(a.local, ['port', 'handles'], `${at}.local`, err);
            if (!Number.isInteger(a.local.port) || a.local.port < 1 || a.local.port > 65535)
              err(`${at}.local.port`, `${show(a.local.port)} must be a port number`);
            // An app's handle ending is <ending>.<domain>, the same space as a PDS's name.
            if (a.local.handles !== undefined) {
              label(a.local.handles, `${at}.local.handles`, err);
              claim(a.local.handles, `${at}.local.handles`);
            }
            app.local = { port: a.local.port, handles: a.local.handles ?? null };
          }
        }
        if (a.hosted !== undefined) {
          if (!isMap(a.hosted)) err(`${at}.hosted`, 'must be a map with service');
          else {
            unknownKeys(a.hosted, ['service', 'link'], `${at}.hosted`, err);
            const port = typeof a.hosted.service === 'string' ? /^[a-z0-9-]+:(\d{1,5})$/.exec(a.hosted.service)?.[1] : null;
            if (!port || +port < 1 || +port > 65535)
              err(`${at}.hosted.service`, `${show(a.hosted.service)} must be <namespace>:<port>`);
            if (a.hosted.link !== undefined && (typeof a.hosted.link !== 'string' || !/^https:\/\/\S+$/.test(a.hosted.link)))
              err(`${at}.hosted.link`, `${show(a.hosted.link)} must be an https URL`);
            app.hosted = { service: a.hosted.service, link: a.hosted.link ?? null };
          }
        }
        apps.push(app);
      });
    }
  }

  // accounts: <handle>@<pds>
  const accounts = [];
  if (doc.accounts !== undefined) {
    if (!Array.isArray(doc.accounts)) err('accounts', 'must be a list of <name>@<pds>');
    else {
      const seen = new Set();
      doc.accounts.forEach((a, i) => {
        const at = `accounts[${i}]`;
        const m = typeof a === 'string' ? /^([^@]+)@([^@]+)$/.exec(a) : null;
        if (!m) return err(at, `${show(a)} must be <name>@<pds>, such as alice@alpha`);
        const [, name, on] = m;
        label(name, at, err);
        const host = pds.find((p) => p.name === on);
        if (!host) return err(at, `"${on}" is not a PDS in this file (${pdsNames.join(', ')})`);
        if (name === AUTHORITY_ACCOUNT) err(at, `"${name}" is the lexicon authority's own account`);
        // A bare handle is <name>.<domain>, the same space as the network's own names.
        if (host.bare_handles && (RESERVED.includes(name) || names.has(name)))
          err(at, `"${name}.${D}" would be the address of ${names.get(name) ?? 'the network itself'}`);
        const handle = host.bare_handles ? `${name}.${D}` : `${name}.${on}.${D}`;
        fits(handle, at);
        if (seen.has(handle)) err(at, `${handle} is listed twice`);
        seen.add(handle);
        accounts.push({ name, pds: on, handle });
      });
    }
  }

  // hosted: read only by the hosted stamp
  const hosted = { base_domain: 'snowglobe.at', ses_region: null };
  if (doc.hosted !== undefined) {
    if (!isMap(doc.hosted)) err('hosted', 'must be a map');
    else {
      unknownKeys(doc.hosted, ['base_domain', 'ses_region'], 'hosted', err);
      if (doc.hosted.base_domain !== undefined) {
        if (typeof doc.hosted.base_domain !== 'string' || !DOMAIN_RE.test(doc.hosted.base_domain))
          err('hosted.base_domain', `${show(doc.hosted.base_domain)} must be a domain name`);
        hosted.base_domain = doc.hosted.base_domain;
      }
      if (doc.hosted.ses_region !== undefined) {
        if (typeof doc.hosted.ses_region !== 'string' || !/^[a-z]{2}-[a-z]+-\d$/.test(doc.hosted.ses_region))
          err('hosted.ses_region', `${show(doc.hosted.ses_region)} must be an AWS region, such as us-east-1`);
        hosted.ses_region = doc.hosted.ses_region;
      }
    }
  }

  const globe = { globe: doc.globe, domain, pds, grouphosts, services, lexicons, accounts, apps, hosted };
  return { globe: errors.length ? null : globe, errors };
}

// A short name from IMAGE_NAMES, or an image pinned by tag or digest. :latest and an
// untagged name move under you, so they are refused.
function imageRef(v, where, err, { required = false } = {}) {
  if (v === undefined) {
    if (required) err(where, 'required');
    return null;
  }
  if (typeof v !== 'string' || v === '') return err(where, 'must be an image name'), null;
  if (Object.hasOwn(IMAGE_NAMES, v)) return IMAGE_NAMES[v];
  const ref = parseImage(v);
  if (!ref) return err(where, `${show(v)} is not an image reference ([registry/]name[:tag][@sha256:<64 hex>])`), null;
  const { tag, digest } = ref;
  if (digest) return v;
  if (!tag) return err(where, `${show(v)} has no tag or digest; pin it, or use one of: ${Object.keys(IMAGE_NAMES).join(', ')}`), null;
  if (tag === 'latest') return err(where, `${show(v)} is :latest, which moves; pin a version or a digest`), null;
  return v;
}

// Split an image reference into its tag and digest, or null when it is not one.
function parseImage(v) {
  let rest = v;
  let digest = null;
  const at = rest.indexOf('@');
  if (at !== -1) {
    const m = /^([a-z0-9]+):([a-f0-9]+)$/.exec(rest.slice(at + 1));
    if (!m || !Object.hasOwn(DIGEST_HEX, m[1]) || m[2].length !== DIGEST_HEX[m[1]]) return null;
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let tag = null;
  const colon = rest.lastIndexOf(':');
  if (colon > rest.lastIndexOf('/') && !rest.slice(colon).includes(']')) {
    tag = rest.slice(colon + 1);
    if (!TAG_RE.test(tag)) return null;
    rest = rest.slice(0, colon);
  }
  if (rest.length > IMAGE_NAME_MAX) return null;
  let parts = rest.split('/');
  const first = parts[0];
  if (parts.length > 1 && (/[.:[A-Z]/.test(first) || first === 'localhost')) {
    if (!REGISTRY_RE.test(first)) return null;
    parts = parts.slice(1);
  }
  return parts.every((p) => PATH_RE.test(p)) ? { tag, digest } : null;
}

function label(v, where, err) {
  if (typeof v !== 'string' || !LABEL_RE.test(v))
    err(where, `${show(v)} must be one lowercase DNS label (letters, digits, inner hyphens)`);
}

function unknownKeys(map, allowed, where, err) {
  for (const k of Object.keys(map))
    if (!allowed.includes(k)) err(where ? `${where}.${k}` : k, `unknown setting; known here: ${allowed.join(', ')}`);
}

// A plain YAML mapping. A !!omap or !!set parses to a Map or Set, whose entries the checks
// below would not see, so it is refused rather than passed unread.
function isMap(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// A value as the file wrote it, for an error message. Never throws: YAML aliases can make a
// value that contains itself.
function show(v) {
  if (v === undefined) return 'nothing';
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'a map' : typeof v;
  }
}
