import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ExcelReporter } from '../../src/reporting/ExcelReporter.js';
import { check, skipped } from '../../src/qa/TestResult.js';
import type { GameQaResult } from '../../src/types/QaResult.js';
import { Redactor } from '../../src/util/Redactor.js';

const dirs: string[] = [];
afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const result = (over: Partial<GameQaResult>): GameQaResult => ({
  gameId: 4182, gameName: 'Crazy Time', provider: 'evolution', currency: 'GBP', declared: true,
  launch: check('PASS', 'ok'), currencyCheck: check('PASS'), minLimit: check('PASS', '', { expected: '0.10', detected: '0.10' }), defaultLimit: skipped(), maxLimit: check('NOT_DETECTED', '', { expected: '100.00' }),
  overall: 'REVIEW', durationMs: 1234, startedAt: '2026-09-28T09:30:00.000Z', errors: [], ...over,
});

describe('ExcelReporter', () => {
  it('writes Summary, Results, Errors and Providers sheets without secrets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qa-report-'));
    dirs.push(dir);
    const redactor = new Redactor();
    redactor.register('SECRET-API-KEY-VALUE');
    const results = [
      result({}),
      result({
        gameId: 4170, gameName: 'XXXTreme Lightning Roulette', provider: 'royal7', overall: 'FAIL', launch: check('FAIL', 'Game not found'),
        errors: [{ step: 'provider-launch', type: 'SEMANTIC_ERROR', httpStatus: 200, url: 'https://s-endpoint.royal7.test/launch/?token=abcdef', contentType: 'application/json', description: 'Error: Game not found (key SECRET-API-KEY-VALUE)', code: -1 }],
      }),
    ];
    const startedAt = new Date('2026-09-28T11:30:00');
    const file = await new ExcelReporter(redactor).write(
      {
        config: { aggregatorUrl: 'https://integration.example.test', launcherUrl: 'https://integration.example.test', partnerCode: 'alpha-test', players: { prefix: 'qa-runner', md5Template: '{user_id}{secret}', hasSecret: true, existing: [] }, currencies: ['GBP'], lang: 'en', workers: 5, expectedLimits: { min: 0.1, max: 100 }, options: { testCurrencies: true, testLimits: true, browserCheck: true, screenshotsOnFailure: true, screenshotsAll: false, testUndeclaredCurrencies: false }, filters: { providers: [], gameIds: [], maxGames: 0 } },
        startedAt, finishedAt: new Date('2026-09-28T11:35:00'), state: 'finished', gamesDiscovered: 2, gamesQueued: 2, gamesCompleted: 2,
        providers: [{ id: 1, code: 'evolution', name: 'Evolution' }, { id: 2, code: 'royal7', name: 'Royal 7' }],
        results,
      },
      dir,
    );
    expect(path.basename(file)).toBe('QA_Report_2026-09-28_11-30-00.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Results', 'Errors', 'Providers']);

    const summary = wb.getWorksheet('Summary')!;
    const values = new Map<string, unknown>();
    summary.eachRow((row) => values.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(values.get('Partner')).toBe('alpha-test');
    expect(values.get('FAIL')).toBe(1);
    expect(values.get('REVIEW')).toBe(1);
    expect(values.get('Workers')).toBe(5);

    const res = wb.getWorksheet('Results')!;
    expect(res.getRow(1).values).toEqual(expect.arrayContaining(['Game', 'Game ID', 'Provider', 'Currency', 'Min', 'Default', 'Max', 'Launch', 'Currency check', 'Overall', 'Duration', 'Error']));
    expect(res.rowCount).toBe(3);
    expect(res.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(res.autoFilter).toBeTruthy();
    expect(res.getRow(3).getCell(11).value).toBe('FAIL');
    expect(res.getRow(2).getCell(6).value).toBe('PASS (esp. 0.10 / det. 0.10)');

    const errors = wb.getWorksheet('Errors')!;
    expect(errors.rowCount).toBe(2);
    expect(errors.getRow(2).getCell(8).value).toBe(200);

    let all = '';
    for (const ws of wb.worksheets) ws.eachRow((row) => (all += JSON.stringify(row.values)));
    expect(all).not.toContain('SECRET-API-KEY-VALUE');
    expect(all).not.toContain('token=abcdef');
  });
});
