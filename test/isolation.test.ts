import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('service configuration isolation', () => {
  it('PDS is configured to use local PLC, not plc.directory', () => {
    const plcUrl = execSync(
      `docker exec devnet-pds printenv PDS_DID_PLC_URL`,
      { encoding: 'utf-8' },
    ).trim();
    expect(plcUrl).toBe('http://plc:2582');
    expect(plcUrl).not.toContain('plc.directory');
  });

  it('PDS has no external crawlers configured', () => {
    const crawlers = execSync(
      `docker exec devnet-pds printenv PDS_CRAWLERS`,
      { encoding: 'utf-8' },
    ).trim();
    expect(crawlers).toBe('');
  });

  it('Jetstream is configured to use local PDS firehose', () => {
    const wsUrl = execSync(
      `docker exec devnet-jetstream printenv JETSTREAM_WS_URL`,
      { encoding: 'utf-8' },
    ).trim();
    expect(wsUrl).toContain('pds:3000');
    expect(wsUrl).not.toContain('bsky.network');
  });

  it('TAP is configured to use local PDS and PLC', () => {
    const relayUrl = execSync(
      `docker exec devnet-tap printenv TAP_RELAY_URL`,
      { encoding: 'utf-8' },
    ).trim();
    const plcUrl = execSync(
      `docker exec devnet-tap printenv TAP_PLC_URL`,
      { encoding: 'utf-8' },
    ).trim();
    expect(relayUrl).toContain('pds:3000');
    expect(plcUrl).toContain('plc:2582');
    expect(relayUrl).not.toContain('bsky.network');
    expect(plcUrl).not.toContain('plc.directory');
  });
});
