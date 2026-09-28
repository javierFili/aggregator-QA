import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Provider } from '../types/Provider.js';
import type { GameQaResult } from '../types/QaResult.js';
import { Redactor, globalRedactor } from '../util/Redactor.js';
import { fileTimestamp, formatDuration } from '../util/time.js';
import type { PublicRunConfig } from '../qa/QaRunner.js';
import { countResults } from '../qa/TestResult.js';
import { STATUS_STYLE, durationText, limitCell, mainError, statusOf } from './ReportFormatter.js';

export interface ReportInput {
  config: PublicRunConfig;
  startedAt: Date;
  finishedAt: Date;
  state: string;
  gamesDiscovered: number;
  gamesQueued: number;
  gamesCompleted: number;
  providers: Provider[];
  results: readonly GameQaResult[];
}

const HEADER_FILL = 'FF1F2937';

/** Generates the `.xlsx` report (Summary, Results, Errors, Providers). Every string goes through the redactor. */
export class ExcelReporter {
  constructor(private readonly redactor: Redactor = globalRedactor) {}

  static fileName(date: Date): string {
    return `QA_Report_${fileTimestamp(date)}.xlsx`;
  }

  async write(input: ReportInput, dir: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, ExcelReporter.fileName(input.startedAt));
    const workbook = this.build(input);
    await workbook.xlsx.writeFile(file);
    return file;
  }

  build(input: ReportInput): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'iGaming QA Runner';
    wb.created = input.finishedAt;
    this.summarySheet(wb, input);
    this.resultsSheet(wb, input.results);
    this.errorsSheet(wb, input.results);
    this.providersSheet(wb, input);
    return wb;
  }

  private summarySheet(wb: ExcelJS.Workbook, input: ReportInput): void {
    const ws = wb.addWorksheet('Summary');
    const counters = countResults(input.results);
    const { config } = input;
    const limits = config.expectedLimits;
    const rows: Array<[string, string | number | Date]> = [
      ['Partner', config.partnerCode],
      ['QA players (1050)', `${config.players.existing.length ? `existing: ${config.players.existing.join(', ')} · others: ` : ''}${config.players.prefix}-<currency>-w<worker>`],
      ['Aggregator URL', config.aggregatorUrl],
      ['Date', input.startedAt],
      ['Finished', input.finishedAt],
      ['Duration', formatDuration(input.finishedAt.getTime() - input.startedAt.getTime())],
      ['Run state', input.state],
      ['Games discovered', input.gamesDiscovered],
      ['Games queued', input.gamesQueued],
      ['Games tested', input.gamesCompleted],
      ['Tests (game × currency)', input.results.length],
      ['Currencies tested', config.currencies.join(', ') || '(declared by 1071)'],
      ['Language', config.lang],
      ['Workers', config.workers],
      ['Expected min bet', limits.min ?? '—'],
      ['Expected default bet', limits.default ?? '—'],
      ['Expected max bet', limits.max ?? '—'],
      ['Browser check', config.options.browserCheck ? 'yes' : 'no'],
      ['Test undeclared currencies', config.options.testUndeclaredCurrencies ? 'yes' : 'no'],
      ['PASS', counters.PASS],
      ['FAIL', counters.FAIL],
      ['REVIEW', counters.REVIEW],
      ['SKIPPED', counters.SKIPPED],
    ];
    ws.columns = [{ width: 28 }, { width: 60 }];
    const title = ws.addRow(['iGaming QA Report']);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    for (const [label, value] of rows) {
      const row = ws.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      if (value instanceof Date) row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
      const style = STATUS_STYLE[label];
      if (style) this.paint(row.getCell(1), style), this.paint(row.getCell(2), style);
      row.getCell(2).alignment = { horizontal: 'left' };
    }
  }

  private resultsSheet(wb: ExcelJS.Workbook, results: readonly GameQaResult[]): void {
    const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Game', key: 'game' },
      { header: 'Game ID', key: 'id' },
      { header: 'Provider', key: 'provider' },
      { header: 'Currency', key: 'currency' },
      { header: 'Declared (1071)', key: 'declared' },
      { header: 'Min', key: 'min' },
      { header: 'Default', key: 'default' },
      { header: 'Max', key: 'max' },
      { header: 'Launch', key: 'launch' },
      { header: 'Currency check', key: 'currencyCheck' },
      { header: 'Overall', key: 'overall' },
      { header: 'Duration', key: 'duration' },
      { header: 'Started at', key: 'startedAt' },
      { header: 'Error', key: 'error' },
      { header: 'Launch detail', key: 'launchDetail' },
      { header: 'Currency detail', key: 'currencyDetail' },
      { header: 'Screenshot', key: 'screenshot' },
      { header: 'Diagnostics', key: 'diagnostics' },
    ];
    const statusCols = ['min', 'default', 'max', 'launch', 'currencyCheck', 'overall'];
    for (const r of results) {
      const row = ws.addRow({
        game: r.gameName,
        id: r.gameId,
        provider: r.provider,
        currency: r.currency,
        declared: r.declared ? 'yes' : 'no',
        min: limitCell(r.minLimit),
        default: limitCell(r.defaultLimit),
        max: limitCell(r.maxLimit),
        launch: r.launch.status,
        currencyCheck: r.currencyCheck.status,
        overall: r.overall,
        duration: durationText(r.durationMs),
        startedAt: new Date(r.startedAt),
        error: this.redactor.text(mainError(r)),
        launchDetail: this.redactor.text(r.launch.detail ?? ''),
        currencyDetail: this.redactor.text(r.currencyCheck.detail ?? ''),
        screenshot: r.screenshot ?? '',
        diagnostics: r.diagnostics ?? '',
      });
      row.getCell('startedAt').numFmt = 'yyyy-mm-dd hh:mm:ss';
      for (const key of statusCols) {
        const cell = row.getCell(key);
        const style = STATUS_STYLE[statusOf(String(cell.value ?? ''))];
        if (style) this.paint(cell, style);
      }
    }
    this.finishTable(ws, { error: 70, launchDetail: 60, currencyDetail: 50 });
  }

  private errorsSheet(wb: ExcelJS.Workbook, results: readonly GameQaResult[]): void {
    const ws = wb.addWorksheet('Errors', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Game', key: 'game' },
      { header: 'Game ID', key: 'id' },
      { header: 'Provider', key: 'provider' },
      { header: 'Currency', key: 'currency' },
      { header: 'Severity', key: 'severity' },
      { header: 'Step', key: 'step' },
      { header: 'Error Type', key: 'type' },
      { header: 'HTTP Status', key: 'status' },
      { header: 'Content-Type', key: 'contentType' },
      { header: 'Code', key: 'code' },
      { header: 'URL', key: 'url' },
      { header: 'Description', key: 'description' },
    ];
    for (const r of results) {
      for (const e of r.errors) {
        const row = ws.addRow({
          game: r.gameName,
          id: r.gameId,
          provider: r.provider,
          currency: r.currency,
          severity: e.warning ? 'WARNING' : 'ERROR',
          step: e.step,
          type: e.type,
          status: e.httpStatus ?? '',
          contentType: e.contentType ?? '',
          code: e.code ?? '',
          url: e.url ? this.redactor.url(e.url) : '',
          description: this.redactor.text(e.description).slice(0, 2000),
        });
        this.paint(row.getCell('severity'), e.warning ? STATUS_STYLE.REVIEW! : STATUS_STYLE.FAIL!);
      }
    }
    this.finishTable(ws, { url: 70, description: 90 });
  }

  private providersSheet(wb: ExcelJS.Workbook, input: ReportInput): void {
    const ws = wb.addWorksheet('Providers', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'ID', key: 'id' },
      { header: 'Code', key: 'code' },
      { header: 'Name', key: 'name' },
      { header: 'Tests', key: 'tests' },
      { header: 'PASS', key: 'PASS' },
      { header: 'FAIL', key: 'FAIL' },
      { header: 'REVIEW', key: 'REVIEW' },
      { header: 'SKIPPED', key: 'SKIPPED' },
    ];
    for (const p of input.providers) {
      const own = input.results.filter((r) => r.provider.toLowerCase() === p.code.toLowerCase());
      ws.addRow({ id: p.id, code: p.code, name: p.name, tests: own.length, ...countResults(own) });
    }
    this.finishTable(ws, {});
  }

  private finishTable(ws: ExcelJS.Worksheet, maxWidths: Record<string, number>): void {
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    header.alignment = { vertical: 'middle' };
    const columnCount = ws.columns.length;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: columnCount } };
    for (const column of ws.columns) {
      let width = String(column.header ?? '').length;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const v = cell.value instanceof Date ? '2026-01-01 00:00:00' : String(cell.value ?? '');
        width = Math.max(width, v.length);
      });
      const cap = (column.key && maxWidths[column.key]) || 45;
      column.width = Math.min(cap, Math.max(8, width + 2));
    }
  }

  private paint(cell: ExcelJS.Cell, style: { fill: string; font: string }): void {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
    cell.font = { ...(cell.font ?? {}), color: { argb: style.font }, bold: true };
  }
}
