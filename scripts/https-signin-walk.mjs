// Signs the spike account in to an unmodified atmo from a headless browser, the way a
// person would: atmo's own sign-in on http://127.0.0.1:5454 (`pnpm dev`, the loopback
// client), the https PDS's sign-in and consent pages, and back to atmo, signed in.
// Run it, and atmo's dev server, under scripts/https-run:
//
//   (cd <atmo>/apps/web && <devnet>/scripts/https-run pnpm dev) &
//   scripts/https-run node scripts/https-signin-walk.mjs
//
// First by DID, then by handle in a fresh browser. A handle goes through atmo's
// resolver: DNS over HTTPS to a public resolver, which knows nothing of the devnet,
// then https://<handle>/.well-known/atproto-did, which the PDS answers. The handle
// attempt is reported, not required. On success the walk prints:
//   SIGNED IN <did> by DID
//   SIGNED IN <did> by handle      (or: HANDLE <what happened>)
//   NAVIGATIONS <n>, 0 off-site
// where on-site means atmo and the PDS. A failure prints a FAIL line and exits 1.
//
// The browser is not under test, so it trusts the devnet's leaf certificate by its
// public key hash (Chromium's --ignore-certificate-errors-spki-list); a person's
// browser trusts data/https/ca.crt instead. atmo's server side verifies TLS against
// the CA, through https-run. Names reach nginx through --host-resolver-rules.
//
// Env: PLAYWRIGHT_MODULE (playwright's index.mjs). The account comes from
// data/https/accounts.env (SPIKEOWNER_*). Its sign-in secret is typed into the PDS's
// form and never printed.
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATMO = 'http://127.0.0.1:5454';
const PDS = 'https://pds.https.devnet.test';
const ON_SITE = new Set([ATMO, PDS]);
const NAMES = ['plc.directory', 'pds.https.devnet.test', '*.https.devnet.test', 'atmo.devnet.internal'];

const credentials = readEnvFile(join(ROOT, 'data/https/accounts.env'));
const account = {
	handle: credentials.SPIKEOWNER_HANDLE,
	did: credentials.SPIKEOWNER_DID,
	secret: credentials.SPIKEOWNER_PASSWORD
};

/** Every line the walk prints goes through here: the secret never appears, nor does the
 *  name of the PDS form field that holds it (a failure may quote the page). */
function say(line) {
	let text = String(line);
	if (account.secret) text = text.split(account.secret).join('<redacted>');
	console.log(text.replace(/passw(or)?d/gi, 'secret'));
}
process.on('uncaughtException', (e) => {
	say(`FAIL ${e instanceof Error ? e.message : e}`);
	process.exit(1);
});
process.on('unhandledRejection', (e) => {
	say(`FAIL ${e instanceof Error ? e.message : e}`);
	process.exit(1);
});

function readEnvFile(file) {
	const vars = {};
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const match = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
		if (match) vars[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
	}
	return vars;
}

for (const [what, value] of Object.entries(account)) {
	if (!value) {
		say(`FAIL data/https/accounts.env has no spike account ${what}; run scripts/https-up.sh`);
		process.exit(1);
	}
}
if (!process.env.PLAYWRIGHT_MODULE) {
	say("FAIL set PLAYWRIGHT_MODULE to playwright's index.mjs");
	process.exit(1);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const leaf = new X509Certificate(readFileSync(join(ROOT, 'data/https/leaf.crt')));
const leafSpki = createHash('sha256')
	.update(leaf.publicKey.export({ type: 'spki', format: 'der' }))
	.digest('base64');

/** Every top-level navigation across the walk, each redirect hop included, by URL. */
const navigations = [];

const browser = await chromium.launch({
	args: [
		`--host-resolver-rules=${NAMES.map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`,
		`--ignore-certificate-errors-spki-list=${leafSpki}`
	]
});

/** A fresh browser: no atmo cookie and no PDS session. Off-site subrequests (the handle
 *  typeahead, avatars) are refused so nothing from the browser reaches the real network,
 *  and the typeahead cannot swap a suggestion in for the typed identifier. A navigation is
 *  never refused, so one that leaves the two sites is counted, not hidden. */
async function freshPage() {
	const context = await browser.newContext();
	context.on('request', (request) => {
		if (!request.isNavigationRequest()) return;
		let frame;
		try {
			frame = request.frame();
		} catch {
			return;
		}
		if (frame.parentFrame() === null) navigations.push(request.url());
	});
	await context.route('**/*', (route) => {
		const request = route.request();
		if (request.isNavigationRequest() || ON_SITE.has(new URL(request.url()).origin)) {
			return route.continue();
		}
		return route.abort('blockedbyclient');
	});
	return { context, page: await context.newPage() };
}

const origin = (url) => new URL(url).origin;

/** A failure on one line: the error and, for a Playwright timeout, what it was waiting on. */
const reason = (e) =>
	e instanceof Error
		? e.message
				.split('\n')
				.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
				.filter((l) => l && !/^=+/.test(l))
				.slice(0, 6)
				.join(' | ')
		: String(e);

/** Types an identifier into atmo's own sign-in form and submits it. */
async function startSignIn(page, identifier) {
	await page.goto(`${ATMO}/login`, { timeout: 120_000 });
	const input = page.locator('input[name=atproto-handle]');
	await input.waitFor({ state: 'visible', timeout: 60_000 });
	await input.fill(identifier);
	await input.press('Enter');
}

/** Signs in and consents on the PDS's pages until the browser is back on atmo. */
async function authorizeOnPds(page) {
	await page.waitForURL((url) => url.origin === PDS || (url.origin === ATMO && url.pathname.startsWith('/oauth/')), {
		timeout: 60_000
	});
	if (origin(page.url()) !== PDS) {
		throw new Error(`atmo did not send the browser to the PDS: ${page.url().split('?')[0]}`);
	}
	const secretField = page.locator('input[type=password]');
	const consent = page.getByRole('button', { name: /^(accept|authorize|allow)$/i }).first();
	// Each is done once: the PDS disables its button while it answers, and a second click
	// would wait on a button the browser has already left behind. A PDS that remembers an
	// earlier consent for this client goes straight back to atmo after the sign-in.
	let signedIn = false;
	let consented = false;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (origin(page.url()) === ATMO) return;
		if (!signedIn && (await secretField.isVisible().catch(() => false))) {
			const username = page.locator('input[name=username]');
			if (
				(await username.count()) &&
				(await username.isEditable()) &&
				!(await username.inputValue())
			) {
				await username.fill(account.handle);
			}
			await secretField.fill(account.secret);
			await page.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 10_000 });
			signedIn = true;
		} else if (!consented && (await consent.isEnabled().catch(() => false))) {
			await consent.click({ timeout: 10_000 });
			consented = true;
		}
		await page.waitForTimeout(250);
	}
	const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
	throw new Error(`still on the PDS at ${page.url().split('?')[0]}; it says: ${text}`);
}

/** The DID atmo itself holds the browser signed in as: the root layout's server data, which
 *  hooks.server.ts fills from the OAuth session it restores for the browser's cookie, and the
 *  profile link the header shows only to a signed-in person. */
async function signedInDid(page) {
	await page.waitForURL((url) => url.origin === ATMO && !url.pathname.startsWith('/oauth/'), {
		timeout: 60_000
	});
	const error = new URL(page.url()).searchParams.get('error');
	if (error) throw new Error(`atmo answered error=${error} at ${new URL(page.url()).pathname}`);
	await page.goto(`${ATMO}/`, { timeout: 120_000 });
	const did = await page.evaluate(async () => {
		const response = await fetch('/__data.json');
		const data = (await response.json()).nodes?.[0]?.data;
		const index = data?.[0]?.did;
		return typeof index === 'number' && index >= 0 ? data[index] : null;
	});
	if (!did) throw new Error('back on atmo, but its layout data holds no signed-in DID');
	await page
		.locator(`a[href="/p/${account.handle}"], a[href="/p/${did}"]`)
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	return did;
}

async function signIn(identifier, how) {
	const { context, page } = await freshPage();
	try {
		await startSignIn(page, identifier);
		await authorizeOnPds(page);
		const did = await signedInDid(page);
		if (did !== account.did) throw new Error(`signed in as ${did}, not ${account.did}`);
		say(`SIGNED IN ${did} by ${how}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, why: reason(e), page: page.url().split('?')[0] };
	} finally {
		await context.close();
	}
}

const byDid = await signIn(account.did, 'DID');
if (!byDid.ok) say(`FAIL sign-in by DID: ${byDid.why}`);

const byHandle = await signIn(account.handle, 'handle');
if (!byHandle.ok) say(`HANDLE did not sign in (browser at ${byHandle.page}): ${byHandle.why}`);

await browser.close();

const offSite = navigations.filter((url) => !ON_SITE.has(origin(url)));
say(`NAVIGATIONS ${navigations.length}, ${offSite.length} off-site`);
for (const url of offSite) say(`FAIL off-site navigation to ${origin(url)}`);
process.exit(byDid.ok && offSite.length === 0 ? 0 : 1);
