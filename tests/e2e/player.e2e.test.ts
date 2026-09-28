import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { createMockAggregator, MOCK_API_KEY } from '../../src/dev/mockAggregator.js';
import { parseRunConfig } from '../../src/qa/QaConfig.js';
import { QaRun } from '../../src/qa/QaRunner.js';

let server: Server;
let baseUrl: string;
let reportsDir: string;
const browserManager = new BrowserManager({ headless: true });

beforeAll(async () => {
  reportsDir = await mkdtemp(path.join(tmpdir(), 'qa-e2e-player-'));
  await new Promise<void>((resolve) => {
    server = createMockAggregator({ driver: 'local', currencyViaParameter: true }).listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await browserManager.close();
  server?.close();
  await rm(reportsDir, { recursive: true, force: true });
});

const run = (extra: Record<string, unknown>) =>
  new QaRun(
    parseRunConfig({ aggregatorUrl: baseUrl, partnerCode: 'alpha-test', apiKey: MOCK_API_KEY, currencies: ['EUR', 'USD', 'GBP'], workers: 2, ...extra }, { defaultWorkers: 5, maxWorkers: 20 }),
    { browserManager, reportsDir, requestTimeoutMs: 10_000, browserTimeoutMs: 20_000, settleTimeoutMs: 2_000 },
  );

describe('partner with the Local/IntWallet driver (like PLAYGG alpha-test)', () => {
  it('registers one player per currency/worker, logs in, detects the front launcher and really tests the games', async () => {
    const r = run({ filters: { gameIds: [4182, 4170, 4200] }, currencies: ['EUR'] });
    await r.start();
    const summary = r.summary();
    expect(summary.error).toBeUndefined();
    expect(summary.state).toBe('finished');
    const byId = Object.fromEntries(r.results.map((x) => [x.gameId, x]));
    expect(byId[4182]!.launch.status, byId[4182]!.launch.detail).toBe('PASS');
    expect(byId[4182]!.overall).toBe('PASS');
    expect(byId[4170]!.launch.status).toBe('FAIL');
    expect(byId[4170]!.errors.some((e) => /Game not found/.test(e.description))).toBe(true);
    expect(byId[4200]!.launch.status).toBe('REVIEW');
  });

  it('a currency the aggregator cannot assign to the player is reported as REVIEW, not PASS', async () => {
    const r = run({ filters: { gameIds: [4182] }, currencies: ['GBP'], players: { prefix: 'qa-gbp-test' } });
    await r.start();
    const res = r.results[0]!;
    expect(res.launch.status).toBe('PASS');
    expect(res.playerCurrency).toBe('EUR');
    expect(res.currencyCheck.status).toBe('REVIEW');
  });

  it('stops early with a clear message when sessions cannot be created', async () => {
    const r = new QaRun(
      parseRunConfig({ aggregatorUrl: baseUrl, partnerCode: 'alpha-test', apiKey: MOCK_API_KEY, currencies: ['EUR'], workers: 2, players: { existing: 'EUR;ghost;;0123' } }, { defaultWorkers: 5, maxWorkers: 20 }),
      { browserManager, reportsDir, requestTimeoutMs: 10_000, browserTimeoutMs: 20_000, settleTimeoutMs: 2_000 },
    );
    await r.start();
    expect(r.summary().state).toBe('failed');
    expect(r.summary().error).toContain('Username or password incorrect');
  });
});
