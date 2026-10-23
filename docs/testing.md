# Test suite

`npm test` runs the `snowglobe-*.test.ts` files with vitest. They need no Docker: they check the file,
what is rendered from it, and each command's refusals.

For the snowglobe end to end on a machine, `node scripts/smoke.mjs` runs the whole sequence (`check`,
`up`, `account` on two PDSes, `invite`, `lexicons`, `app` add and remove, `run`, `down -v`) on a copy of
the checkout with its own state folder, as compose project `snowglobe-smoke` on `127.0.0.3` (a second
loopback address, so it can run beside your own snowglobe), and prints one line per step. It exits 0
only when every step passed. Your own snowglobes' state (`~/.local/share/snowglobe`) is not touched.
It takes a few minutes, more on a first run that pulls the images. CI runs the same two things.
