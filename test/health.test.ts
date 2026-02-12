import { describe, it, expect } from 'vitest';
import { PDS_URL, PLC_URL, JETSTREAM_METRICS_URL, TAP_URL, fetchRetry } from './setup.js';

describe('health checks', () => {
  it('PDS is healthy', async () => {
    const res = await fetchRetry(`${PDS_URL}/xrpc/_health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.version).toBeDefined();
  });

  it('PLC is healthy', async () => {
    const res = await fetchRetry(`${PLC_URL}/_health`);
    expect(res.ok).toBe(true);
  });

  it('Jetstream is healthy', async () => {
    const res = await fetchRetry(`${JETSTREAM_METRICS_URL}/metrics`);
    expect(res.ok).toBe(true);
  });

  it('TAP is healthy', async () => {
    const res = await fetchRetry(`${TAP_URL}/health`);
    expect(res.ok).toBe(true);
  });
});
