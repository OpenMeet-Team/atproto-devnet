import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadAccounts, PDS_URL, JETSTREAM_WS_URL, waitFor } from './setup.js';
import { AtpAgent } from '@atproto/api';
import WebSocket from 'ws';

describe('jetstream events', () => {
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

  it('receives commit event when record is created', async () => {
    const events: any[] = [];

    // Subscribe to Jetstream BEFORE writing
    const ws = new WebSocket(
      `${JETSTREAM_WS_URL}/subscribe?wantedCollections=app.bsky.feed.post`,
    );

    ws.on('message', (data: Buffer) => {
      try {
        events.push(JSON.parse(data.toString()));
      } catch {
        // ignore non-JSON messages
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Write a record to PDS
    const uniqueText = `jetstream-test-${Date.now()}`;
    await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: uniqueText,
        createdAt: new Date().toISOString(),
      },
    });

    // Wait for the event to arrive
    await waitFor(
      () => events.some((e) => e.commit?.record?.text === uniqueText),
      { timeout: 15_000 },
    );

    const event = events.find((e) => e.commit?.record?.text === uniqueText);
    expect(event).toBeDefined();
    expect(event.did).toBe(did);
    expect(event.commit.collection).toBe('app.bsky.feed.post');
    expect(event.commit.operation).toBe('create');

    ws.close();
  });

  it('filters by wantedCollections', async () => {
    const events: any[] = [];

    // Subscribe only to app.bsky.feed.like — should NOT see posts
    const ws = new WebSocket(
      `${JETSTREAM_WS_URL}/subscribe?wantedCollections=app.bsky.feed.like`,
    );

    ws.on('message', (data: Buffer) => {
      try {
        events.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Write a POST (not a like)
    await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: `filter-test-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    });

    // Wait a bit — the post event should NOT arrive
    await new Promise((r) => setTimeout(r, 3000));

    const postEvents = events.filter(
      (e) => e.commit?.collection === 'app.bsky.feed.post',
    );
    expect(postEvents).toHaveLength(0);

    ws.close();
  });

  it('filters by wantedDids', async () => {
    const accounts = loadAccounts();
    const events: any[] = [];

    // Subscribe only to Bob's DID
    const ws = new WebSocket(
      `${JETSTREAM_WS_URL}/subscribe?wantedDids=${accounts.BOB_DID}`,
    );

    ws.on('message', (data: Buffer) => {
      try {
        events.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Alice writes (should NOT appear)
    await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: `alice-did-filter-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    });

    await new Promise((r) => setTimeout(r, 3000));

    const aliceEvents = events.filter((e) => e.did === did);
    expect(aliceEvents).toHaveLength(0);

    ws.close();
  });
});
