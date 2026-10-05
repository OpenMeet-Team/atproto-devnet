import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

/**
 * Use `docker compose exec` instead of `docker exec` so we reference
 * services by compose service name rather than hardcoded container names.
 * This works regardless of the project name or container naming scheme.
 */
function composeExec(service: string, cmd: string): string {
  return execSync(
    `docker compose -f docker-compose.yml -f docker-compose.test.yml exec -T ${service} ${cmd}`,
    { encoding: 'utf-8', cwd: import.meta.dirname + '/..' },
  ).trim();
}

describe('service configuration isolation', () => {
  it('PDS is configured to use local PLC, not plc.directory', () => {
    const plcUrl = composeExec('pds', 'printenv PDS_DID_PLC_URL');
    expect(plcUrl).toBe('http://plc:2582');
    expect(plcUrl).not.toContain('plc.directory');
  });

  it('PDS has no external crawlers configured', () => {
    const crawlers = composeExec('pds', 'printenv PDS_CRAWLERS');
    expect(crawlers).toBe('');
  });

  it("PDS does not forward requests to Bluesky's AppView", () => {
    const appView = composeExec('pds', 'printenv PDS_BSKY_APP_VIEW_URL');
    expect(appView).not.toContain('bsky.app');
  });

  it('Jetstream is configured to use local PDS firehose', () => {
    // the PDS directly, or a local relay (docker-compose.relay.yml)
    const wsUrl = composeExec('jetstream', 'printenv JETSTREAM_WS_URL');
    expect(wsUrl).toMatch(/^ws:\/\/(pds|localhost):\d+\//);
    expect(wsUrl).not.toContain('bsky.network');
  });

  it('TAP is configured to use local PDS and PLC', () => {
    const relayUrl = composeExec('tap', 'printenv TAP_RELAY_URL');
    const plcUrl = composeExec('tap', 'printenv TAP_PLC_URL');
    expect(relayUrl).toMatch(/^http:\/\/(pds|localhost):\d+$/);
    expect(plcUrl).toContain('plc:2582');
    expect(relayUrl).not.toContain('bsky.network');
    expect(plcUrl).not.toContain('plc.directory');
  });
});
