import express from 'express';
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
import { FakeWallet } from '../../src/wallet/FakeWallet.js';

const servers: Server[] = [];
let reportsDir: string;
const browserManager = new BrowserManager({ headless: true });
const listen = (app: express.Express): Promise<string> =>
  new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
    servers.push(s);
  });

let withWallet: string;
let withoutWallet: string;
const wallet = new FakeWallet({ defaultBalance: 100, balances: {} });

beforeAll(async () => {
  reportsDir = await mkdtemp(path.join(tmpdir(), 'qa-e2e-seamless-'));
  const walletApp = express();
  walletApp.use('/wallet', wallet.router());
  const walletBase = await listen(walletApp);
  withWallet = await listen(createMockAggregator({ walletUrl: `${walletBase}/wallet` }));
  withoutWallet = await listen(createMockAggregator({ walletUrl: 'http://127.0.0.1:9/wallet' }));
});

afterAll(async () => {
  await browserManager.close();
  for (const s of servers) s.close();
  await rm(reportsDir, { recursive: true, force: true });
});

const run = (base: string) =>
  new QaRun(
    parseRunConfig({ aggregatorUrl: `${base}/alpha-test`, apiKey: MOCK_API_KEY, currencies: ['EUR'], workers: 2, filters: { gameIds: [4182] } }, { defaultWorkers: 5, maxWorkers: 20 }),
    { browserManager, reportsDir, requestTimeoutMs: 10_000, browserTimeoutMs: 20_000, settleTimeoutMs: 2_000 },
  );

describe('seamless partner asking for the balance (2051)', () => {
  it('without a wallet answering: the aggregator shows "GetBalance Seamless failed"', async () => {
    const r = run(withoutWallet);
    await r.start();
    expect(r.results[0]!.launch.status).toBe('FAIL');
    expect(r.results[0]!.errors.some((e) => /GetBalance Seamless failed/.test(e.description))).toBe(true);
  });

  it('with the fake wallet: the game opens (balance 100)', async () => {
    const r = run(withWallet);
    await r.start();
    expect(r.results[0]!.launch.status, r.results[0]!.launch.detail).toBe('PASS');
    expect(wallet.stats.calls.balance).toBeGreaterThan(0);
  });
});
