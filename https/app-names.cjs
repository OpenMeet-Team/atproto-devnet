// Preloaded into each PDS (NODE_OPTIONS=--require, in the globe bin/snowglobe.mjs render writes), so a PDS can
// reach an app at https://<name>.devnet.internal: it fetches a confidential client's
// metadata and keys from there. Docker's DNS has no wildcard names, so every such name is
// looked up as nginx instead, which routes it by name (https/nginx.conf.template). Only
// the address lookup changes: the request still carries the app's name, and TLS still
// checks the certificate for it against the devnet CA. Every other name resolves as usual.
//
// SG_RESOLVE_DOMAIN adds a domain whose names, itself included, go to nginx too. A group
// host sets it to the globe's domain: it resolves its members' handles, which Docker's DNS does
// not know.
'use strict';
const dns = require('dns');

const SUFFIX = '.devnet.internal';
// DEVNET_ was these settings' prefix until 2026-10-20; a container made before then still has it.
const DOMAIN = (process.env.SG_RESOLVE_DOMAIN || process.env.DEVNET_RESOLVE_DOMAIN || '').toLowerCase();
const PROXY = process.env.SG_APP_PROXY_HOST || process.env.DEVNET_APP_PROXY_HOST || 'nginx';
const isApp = (name) => {
  if (typeof name !== 'string') return false;
  const n = name.toLowerCase().replace(/\.$/, '');
  return n.endsWith(SUFFIX) || (DOMAIN !== '' && (n === DOMAIN || n.endsWith(`.${DOMAIN}`)));
};

const lookup = dns.lookup;
dns.lookup = function devnetLookup(hostname, ...rest) {
  return lookup.call(this, isApp(hostname) ? PROXY : hostname, ...rest);
};

const lookupPromise = dns.promises.lookup;
dns.promises.lookup = function devnetLookupPromise(hostname, ...rest) {
  return lookupPromise.call(this, isApp(hostname) ? PROXY : hostname, ...rest);
};
