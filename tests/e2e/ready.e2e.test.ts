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
  reportsDir = await mkdtemp(path.join(tmpdir(), 'qa-e2e-ready-'));
  await new Promise<void>((resolve) => {
    server = createMockAggregator({ loadingMs: 6000 }).listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await browserManager.close();
  server?.close();
  await rm(reportsDir, { recursive: true, force: true });
});

const run = (readyTimeout: number) =>
  new QaRun(
    parseRunConfig(
      { aggregatorUrl: `${baseUrl}/alpha-test`, apiKey: MOCK_API_KEY, currencies: ['GBP'], filters: { gameIds: [4182] }, expectedLimits: { min: '0.10' }, options: { readyTimeout } },
      { defaultWorkers: 5, maxWorkers: 20 },
    ),
    { browserManager, reportsDir, requestTimeoutMs: 10_000, browserTimeoutMs: 20_000, settleTimeoutMs: 2_000 },
  );

describe('waiting until the game has finished loading', () => {
  it('without the extra wait, a slow game is caught on its loading screen: currency not visible yet', async () => {
    const r = run(0);
    await r.start();
    expect(r.results[0]!.launch.status).toBe('PASS');
    expect(r.results[0]!.currencyCheck.status).toBe('NOT_DETECTED');
  });

  it('with the wait: it waits past the loading screen until the currency is visible, then validates it', async () => {
    const r = run(30);
    await r.start();
    const res = r.results[0]!;
    expect(res.currencyCheck.status, res.currencyCheck.detail).toBe('PASS');
    expect(res.minLimit.status).toBe('PASS');
    expect(res.launch.detail).toContain('divisa visible');
    expect(res.durationMs).toBeLessThan(20_000); // stops as soon as the currency shows, not at the 30 s cap
  });
});
