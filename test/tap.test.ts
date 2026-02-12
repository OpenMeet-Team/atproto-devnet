import { describe, it, expect, beforeAll } from 'vitest';
import { loadAccounts, PDS_URL, TAP_URL } from './setup.js';
import { AtpAgent } from '@atproto/api';

describe('TAP sync', () => {
  let agent: AtpAgent;
  let did: string;

  beforeAll(async () => {
    const accounts = loadAccounts();
    agent = new AtpAgent({ service: PDS_URL });
    await agent.login({
      identifier: accounts.ALICE_HANDLE,
      password: accounts.ALICE_PASSWORD,
    });
    did = agent.session!.did;
  });

  it('can track a DID via repos/add', async () => {
    const res = await fetch(`${TAP_URL}/repos/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dids: [did] }),
    });
    expect(res.ok).toBe(true);
  });

  // TAP resync resolves the DID doc's service endpoint (devnet.test) via DNS,
  // which doesn't work without CoreDNS. Live event delivery depends on successful
  // resync. Re-enable this test after adding CoreDNS for handle resolution.
  it.todo('receives live events after tracking (needs CoreDNS for DID resolution)');
});
