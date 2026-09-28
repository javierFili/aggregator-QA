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
const WAF = { header: 'X-QA-Runner', value: 'let-me-in-123' };

beforeAll(async () => {
  reportsDir = await mkdtemp(path.join(tmpdir(), 'qa-e2e-waf-'));
  await new Promise<void>((resolve) => {
    server = createMockAggregator({ driver: 'local', currencyViaParameter: true, waf: WAF }).listen(0, '127.0.0.1', () => resolve());
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
    parseRunConfig({ aggregatorUrl: `${baseUrl}/alpha-test`, apiKey: MOCK_API_KEY, currencies: ['EUR'], workers: 2, ...extra }, { defaultWorkers: 5, maxWorkers: 20 }),
    { browserManager, reportsDir, requestTimeoutMs: 10_000, browserTimeoutMs: 20_000, settleTimeoutMs: 2_000 },
  );

describe('Cloudflare in front of the launcher', () => {
  it('without being allowed: games are never FAIL; the run stops with a clear explanation', async () => {
    const r = run({ filters: { maxGames: 0 }, currencies: ['EUR'] });
    await r.start();
    expect(r.results.every((x) => x.launch.status !== 'FAIL' || !x.errors.some((e) => e.type === 'WAF_BLOCKED'))).toBe(true);
    expect(r.results.some((x) => x.errors.some((e) => e.type === 'WAF_BLOCKED'))).toBe(true);
    expect(r.results.filter((x) => x.overall === 'FAIL')).toHaveLength(0);
  });

  it('with the access header: the games are really tested (4182 PASS, 4170 FAIL)', async () => {
    const r = run({ accessHeader: { name: WAF.header, value: WAF.value }, filters: { gameIds: [4182, 4170] } });
    await r.start();
    const byId = Object.fromEntries(r.results.map((x) => [x.gameId, x]));
    expect(byId[4182]!.launch.status, byId[4182]!.launch.detail).toBe('PASS');
    expect(byId[4170]!.launch.status).toBe('FAIL');
    expect(JSON.stringify(r.results)).not.toContain(WAF.value);
  });
});
