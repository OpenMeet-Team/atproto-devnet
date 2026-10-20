// A snowglobe command's words, read with util.parseArgs the way the CLI has always read them: an
// option's value is the next word even when it starts with a dash (--out -x), and every other
// word that starts with one is refused, as are --name=value and a bare --. parseArgs in strict
// mode differs on each of those, so it reads loosely here and its tokens are checked instead.

import { parseArgs } from 'node:util';

/**
 * Read `args` for `command`, a command's descriptor: its options (as parseArgs takes them), how
 * many positionals it takes ([min, max]), and `accepts`, any rule on the shape beyond those.
 * Returns { values, positionals, tokens }, or null for words the command does not take.
 */
export function readArgs(command, args) {
  const options = command.options ?? {};
  const { values, positionals, tokens } = parseArgs({ args, options, strict: false, allowPositionals: true, tokens: true });
  for (const t of tokens) {
    if (t.kind === 'option-terminator') return null;
    if (t.kind === 'positional' && t.value.startsWith('-')) return null;
    if (t.kind === 'option') {
      if (!Object.hasOwn(options, t.name) || t.inlineValue) return null;
      // A string option as the last word, with no value after it.
      if (options[t.name].type === 'string' && t.value === undefined) return null;
    }
  }
  const [min, max] = command.positionals ?? [0, 0];
  if (positionals.length < min || positionals.length > max) return null;
  const parsed = { values, positionals, tokens };
  return !command.accepts || command.accepts(parsed) ? parsed : null;
}
