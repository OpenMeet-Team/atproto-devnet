// The names snowglobe run maps to nginx, and the hosts file it binds over /etc/hosts. Pure:
// lib/commands/run.mjs reads the files and runs the command.

const NAME_RE = /^[A-Za-z0-9.-]+$/;
const words = (text) => (text ?? '').split(/\s+/).filter(Boolean);

/**
 * Every name a process under run should reach nginx at: the rendered globe's leaf names that are
 * not wildcards (its page, each PDS, its services, plc.directory), each handle in `handles`
 * (data/https/names), <name>.devnet.internal for each app in `apps`, and `extra`
 * (HTTPS_RUN_EXTRA_NAMES, space-separated). In that order, each once.
 */
export function runNames({ leafNames, handles, apps, extra }) {
  return [
    ...new Set([
      ...words(leafNames).filter((n) => !n.startsWith('*')),
      // One per line; a line that is not a name is skipped whole.
      ...(handles ?? '').split('\n').filter((n) => NAME_RE.test(n)),
      ...apps.map((a) => `${a.name}.devnet.internal`),
      ...words(extra),
    ]),
  ];
}

/**
 * The hosts file: `etcHosts` (the machine's) without any line naming one of `names`, then each
 * name on `bind`.
 */
export function hostsFile(etcHosts, names, bind) {
  const ours = new Set(names);
  const kept = etcHosts
    .split('\n')
    .filter((l, i, all) => i < all.length - 1 || l !== '')
    .filter((l) => !l.trim().split(/\s+/).slice(1).some((n) => ours.has(n)));
  return [...kept, '# https devnet (bin/snowglobe.mjs run)', ...names.map((n) => `${bind} ${n}`), ''].join('\n');
}
