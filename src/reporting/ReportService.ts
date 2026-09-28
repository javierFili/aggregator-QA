import { existsSync } from 'node:fs';
import path from 'node:path';
import type { QaRun } from '../qa/QaRunner.js';
import { createLogger } from '../util/logger.js';
import { ExcelReporter } from './ExcelReporter.js';

const log = createLogger('report');

/** Writes the Excel report of a run into its run folder; regenerates only when results changed. */
export class ReportService {
  private readonly cache = new Map<string, { key: string; file: string }>();

  constructor(private readonly reporter = new ExcelReporter()) {}

  async generate(run: QaRun): Promise<string> {
    const summary = run.summary();
    const key = `${summary.state}:${summary.testsCompleted}`;
    const cached = this.cache.get(run.id);
    if (cached && cached.key === key && existsSync(cached.file)) return cached.file;
    const file = await this.reporter.write(
      {
        config: run.publicConfig,
        startedAt: run.startedAt,
        finishedAt: summary.finishedAt ? new Date(summary.finishedAt) : new Date(),
        state: summary.state,
        gamesDiscovered: summary.gamesDiscovered,
        gamesQueued: summary.gamesQueued,
        gamesCompleted: summary.gamesCompleted,
        providers: summary.providers,
        results: run.results,
      },
      run.runDir,
    );
    this.cache.set(run.id, { key, file });
    log.info(`Excel report written: ${path.relative(process.cwd(), file)}`);
    return file;
  }
}
