// Preloaded into each PDS (NODE_OPTIONS=--require, docker-compose.https.yml), so a PDS can
// reach an app at https://<name>.devnet.internal: it fetches a confidential client's
// metadata and keys from there. Docker's DNS has no wildcard names, so every such name is
// looked up as nginx instead, which routes it by name (https/nginx.conf). Only the address
// lookup changes: the request still carries the app's name, and TLS still checks the
// certificate for it against the devnet CA. Every other name resolves as usual.
'use strict';
const dns = require('dns');

const SUFFIX = '.devnet.internal';
const PROXY = process.env.DEVNET_APP_PROXY_HOST || 'nginx';
const isApp = (name) => typeof name === 'string' && name.toLowerCase().replace(/\.$/, '').endsWith(SUFFIX);

const lookup = dns.lookup;
dns.lookup = function devnetLookup(hostname, ...rest) {
  return lookup.call(this, isApp(hostname) ? PROXY : hostname, ...rest);
};

const lookupPromise = dns.promises.lookup;
dns.promises.lookup = function devnetLookupPromise(hostname, ...rest) {
  return lookupPromise.call(this, isApp(hostname) ? PROXY : hostname, ...rest);
};
