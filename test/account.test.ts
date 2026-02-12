import { describe, it, expect } from 'vitest';
import { loadAccounts, PDS_URL } from './setup.js';
import { AtpAgent } from '@atproto/api';

describe('account seeding', () => {
  it('accounts.env exists with seeded credentials', () => {
    const accounts = loadAccounts();
    expect(accounts.DEVNET_INVITE_CODE).toBeDefined();
    expect(accounts.ALICE_DID).toMatch(/^did:plc:/);
    expect(accounts.ALICE_HANDLE).toContain('alice');
    expect(accounts.ALICE_PASSWORD).toBeDefined();
    expect(accounts.BOB_DID).toMatch(/^did:plc:/);
    expect(accounts.BOB_HANDLE).toContain('bob');
    expect(accounts.BOB_PASSWORD).toBeDefined();
  });

  it('alice can log in to PDS', async () => {
    const accounts = loadAccounts();
    const agent = new AtpAgent({ service: PDS_URL });
    const res = await agent.login({
      identifier: accounts.ALICE_HANDLE,
      password: accounts.ALICE_PASSWORD,
    });
    expect(res.data.did).toBe(accounts.ALICE_DID);
    expect(res.data.handle).toBe(accounts.ALICE_HANDLE);
  });

  it('bob can log in to PDS', async () => {
    const accounts = loadAccounts();
    const agent = new AtpAgent({ service: PDS_URL });
    const res = await agent.login({
      identifier: accounts.BOB_HANDLE,
      password: accounts.BOB_PASSWORD,
    });
    expect(res.data.did).toBe(accounts.BOB_DID);
    expect(res.data.handle).toBe(accounts.BOB_HANDLE);
  });
});
