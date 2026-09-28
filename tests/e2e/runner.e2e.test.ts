import ExcelJS from 'exceljs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/browser/BrowserManager.js';
import { createMockAggregator, MOCK_API_KEY } from '../../src/dev/mockAggregator.js';
import { parseRunConfig } from '../../src/qa/QaConfig.js';
import { QaRun } from '../../src/qa/QaRunner.js';
import { ReportService } from '../../src/reporting/ReportService.js';

let server: Server;
let baseUrl: string;
let reportsDir: string;
const browserManager = new BrowserManager({ headless: true });

beforeAll(async () => {
  reportsDir = await mkdtemp(path.join(tmpdir(), 'qa-e2e-'));
  await new Promise<void>((resolve) => {
    server = createMockAggregator().listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await browserManager.close();
  server?.close();
  await rm(reportsDir, { recursive: true, force: true });
});

function newRun(overrides: Record<string, unknown> = {}): QaRun {
  const config = parseRunConfig(
    {
      aggregatorUrl: baseUrl,
      partnerCode: 'alpha-test',
      apiKey: MOCK_API_KEY,
      currencies: ['GBP', 'EUR', 'BRL'],
      workers: 3,
      expectedLimits: { min: '0.10', default: '1', max: '100' },
      ...overrides,
    },
    { defaultWorkers: 5, maxWorkers: 20 },
  );
  return new QaRun(config, { browserManager, reportsDir, requestTimeoutMs: 10_000, browserTimeoutMs: 20_000, settleTimeoutMs: 3_000 });
}

describe('QA run against the mock aggregator (real Chromium)', () => {
  it('passes Crazy Time, fails XXXTreme (HTTP 200 + JSON error), reviews the blank game', async () => {
    const run = newRun();
    await run.start();
    const summary = run.summary();
    expect(summary.state).toBe('finished');
    expect(summary.providers).toHaveLength(3);
    expect(summary.gamesDiscovered).toBe(3);
    expect(summary.gamesCompleted).toBe(3);

    const find = (id: number, currency: string) => run.results.find((r) => r.gameId === id && r.currency === currency)!;

    // 4182 — works: launch, currency and all limits detected
    const ok = find(4182, 'GBP');
    expect(ok.launch.status, ok.launch.detail).toBe('PASS');
    expect(ok.currencyCheck.status, ok.currencyCheck.detail).toBe('PASS');
    expect([ok.minLimit.status, ok.defaultLimit.status, ok.maxLimit.status]).toEqual(['PASS', 'PASS', 'PASS']);
    expect(ok.overall).toBe('PASS');
    expect(find(4182, 'EUR').overall).toBe('PASS');
    expect(find(4182, 'BRL')).toMatchObject({ overall: 'SKIPPED', currencyCheck: { status: 'NOT_DECLARED' } });

    // 4170 — HTTP 200 + semantic JSON error must be FAIL
    const bad = find(4170, 'GBP');
    expect(bad.launch.status).toBe('FAIL');
    expect(bad.overall).toBe('FAIL');
    expect(bad.errors.filter((e) => e.type === 'SEMANTIC_ERROR')).toHaveLength(1);
    const semantic = bad.errors.find((e) => e.type === 'SEMANTIC_ERROR')!;
    expect(semantic).toMatchObject({ step: 'provider-launch', httpStatus: 200 });
    expect(semantic.description).toContain('Game not found');
    expect(bad.screenshot).toBe('screenshots/4170_GBP.png');
    expect(existsSync(path.join(run.runDir, bad.screenshot!))).toBe(true);
    const diag = await readFile(path.join(run.runDir, bad.diagnostics!), 'utf8');
    expect(diag).toContain('Game not found');
    expect(diag).not.toContain(MOCK_API_KEY);

    // 4200 — blank frontend: REVIEW, not PASS
    expect(find(4200, 'EUR').launch.status).toBe('REVIEW');
    expect(find(4200, 'EUR').overall).toBe('REVIEW');

    // Excel report
    const file = await new ReportService().generate(run);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.getWorksheet('Results')!.rowCount).toBe(run.results.length + 1);
    let all = '';
    for (const ws of wb.worksheets) ws.eachRow((row) => (all += JSON.stringify(row.values)));
    expect(all).not.toContain(MOCK_API_KEY);
    expect(browserManager.openContexts).toBe(0);
  });

  it('detects limit mismatches as FAIL', async () => {
    const run = newRun({ currencies: ['GBP'], expectedLimits: { min: '0.20' }, filters: { gameIds: [4182] } });
    await run.start();
    const r = run.results[0]!;
    expect(r.minLimit).toMatchObject({ status: 'FAIL', expected: '0.20', detected: '0.10' });
    expect(r.overall).toBe('FAIL');
  });

  it('stop() produces a partial run', async () => {
    const run = newRun({ workers: 1, currencies: ['EUR'] });
    const done = run.start();
    run.stop();
    await done;
    expect(run.summary().state).toBe('stopped');
    expect(run.summary().gamesCompleted).toBeLessThan(3);
  });
});
