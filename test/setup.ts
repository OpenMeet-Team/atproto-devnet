import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

export interface DevnetAccounts {
  DEVNET_INVITE_CODE: string;
  ALICE_HANDLE: string;
  ALICE_DID: string;
  ALICE_PASSWORD: string;
  ALICE_EMAIL: string;
  BOB_HANDLE: string;
  BOB_DID: string;
  BOB_PASSWORD: string;
  BOB_EMAIL: string;
}

/**
 * Parse the accounts.env file written by init.sh
 */
export function loadAccounts(): DevnetAccounts {
  const envPath = resolve(ROOT, 'data/accounts.env');
  if (!existsSync(envPath)) {
    throw new Error(`accounts.env not found at ${envPath} — has init completed?`);
  }
  const content = readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }
  return env as unknown as DevnetAccounts;
}

/**
 * Load port overrides from the project .env file (same file docker compose reads).
 * Falls back to the default container ports if .env doesn't exist or lacks overrides.
 */
function loadEnvPorts(): Record<string, string> {
  const dotenvPath = resolve(ROOT, '.env');
  if (!existsSync(dotenvPath)) return {};
  const content = readFileSync(dotenvPath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }
  return env;
}

const envPorts = loadEnvPorts();

/** Base URLs for devnet services (host-side ports from .env) */
export const PDS_URL = process.env.DEVNET_PDS_URL || `http://localhost:${envPorts.DEVNET_PDS_PORT || '3000'}`;
export const PLC_URL = process.env.DEVNET_PLC_URL || `http://localhost:${envPorts.DEVNET_PLC_PORT || '2582'}`;
export const JETSTREAM_WS_URL = process.env.DEVNET_JETSTREAM_WS_URL || `ws://localhost:${envPorts.DEVNET_JETSTREAM_PORT || '6008'}`;
export const JETSTREAM_METRICS_URL = process.env.DEVNET_JETSTREAM_METRICS_URL || `http://localhost:${envPorts.DEVNET_JETSTREAM_METRICS_PORT || '6009'}`;
export const TAP_URL = process.env.DEVNET_TAP_URL || `http://localhost:${envPorts.DEVNET_TAP_PORT || '2480'}`;
export const TAP_WS_URL = process.env.DEVNET_TAP_WS_URL || `ws://localhost:${envPorts.DEVNET_TAP_PORT || '2480'}`;

/**
 * Wait for a condition to become true, polling at interval.
 */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  { timeout = 10_000, interval = 200 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Fetch with retry — useful for waiting on services that are still starting.
 */
export async function fetchRetry(
  url: string,
  opts?: RequestInit & { retries?: number; retryDelay?: number },
): Promise<Response> {
  const { retries = 5, retryDelay = 1000, ...fetchOpts } = opts || {};
  let lastError: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, fetchOpts);
      return res;
    } catch (e) {
      lastError = e as Error;
      if (i < retries) await new Promise((r) => setTimeout(r, retryDelay));
    }
  }
  throw lastError;
}
