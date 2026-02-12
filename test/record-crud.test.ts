import { describe, it, expect, beforeAll } from 'vitest';
import { loadAccounts, PDS_URL } from './setup.js';
import { AtpAgent } from '@atproto/api';

describe('record CRUD', () => {
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

  it('can create a record', async () => {
    const res = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'hello from devnet',
        createdAt: new Date().toISOString(),
      },
    });
    expect(res.data.uri).toContain(did);
    expect(res.data.cid).toBeDefined();
  });

  it('can read a record back', async () => {
    // Create a record with known content
    const createRes = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'record-crud-read-test',
        createdAt: new Date().toISOString(),
      },
    });

    // Parse rkey from URI: at://did/collection/rkey
    const rkey = createRes.data.uri.split('/').pop()!;

    const getRes = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      rkey,
    });

    expect((getRes.data.value as any).text).toBe('record-crud-read-test');
  });

  it('can delete a record', async () => {
    const createRes = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'record-to-delete',
        createdAt: new Date().toISOString(),
      },
    });

    const rkey = createRes.data.uri.split('/').pop()!;

    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      rkey,
    });

    // Verify it's gone
    await expect(
      agent.com.atproto.repo.getRecord({
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey,
      }),
    ).rejects.toThrow();
  });

  it('can list records in a collection', async () => {
    const listRes = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: 'app.bsky.feed.post',
      limit: 10,
    });

    expect(listRes.data.records.length).toBeGreaterThan(0);
    expect(listRes.data.records[0].uri).toContain('app.bsky.feed.post');
  });
});
