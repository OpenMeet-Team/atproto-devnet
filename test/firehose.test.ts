import { describe, it, expect, beforeAll } from 'vitest';
import { loadAccounts, PDS_URL, waitFor } from './setup.js';
import { AtpAgent } from '@atproto/api';
import WebSocket from 'ws';

describe('raw PDS firehose', () => {
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

  it('emits CBOR events on record create', async () => {
    const messages: Buffer[] = [];

    // Subscribe to raw firehose (CBOR frames, not JSON)
    const ws = new WebSocket(
      `${PDS_URL.replace('http', 'ws')}/xrpc/com.atproto.sync.subscribeRepos`,
    );

    ws.on('message', (data: Buffer) => {
      messages.push(Buffer.from(data as any));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Write a record
    await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: `firehose-test-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    });

    // Wait for at least one CBOR message
    await waitFor(() => messages.length > 0, { timeout: 10_000 });

    // Firehose messages are CBOR-encoded, not JSON
    // Just verify we got binary data (not empty)
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].length).toBeGreaterThan(0);

    ws.close();
  });
});
