import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redactor, globalRedactor } from '../util/Redactor.js';

/**
 * Run folder layout:
 *   reports/<timestamp>/QA_Report_<timestamp>.xlsx
 *   reports/<timestamp>/screenshots/<gameId>_<currency>.png
 *   reports/<timestamp>/diagnostics/<gameId>_<currency>.json
 */
export class EvidenceWriter {
  readonly screenshotsDir: string;
  readonly diagnosticsDir: string;

  constructor(
    readonly runDir: string,
    private readonly redactor: Redactor = globalRedactor,
  ) {
    this.screenshotsDir = path.join(runDir, 'screenshots');
    this.diagnosticsDir = path.join(runDir, 'diagnostics');
  }

  async init(): Promise<void> {
    await mkdir(this.screenshotsDir, { recursive: true });
    await mkdir(this.diagnosticsDir, { recursive: true });
  }

  static baseName(gameId: number, currency: string): string {
    return `${gameId}_${currency.replace(/[^A-Za-z0-9]/g, '') || 'NA'}`;
  }

  screenshotPath(gameId: number, currency: string): { absolute: string; relative: string } {
    const file = `${EvidenceWriter.baseName(gameId, currency)}.png`;
    return { absolute: path.join(this.screenshotsDir, file), relative: `screenshots/${file}` };
  }

  /** Writes a redacted diagnostic JSON and returns its path relative to the run folder. */
  async writeDiagnostics(gameId: number, currency: string, data: unknown): Promise<string> {
    const file = `${EvidenceWriter.baseName(gameId, currency)}.json`;
    await writeFile(path.join(this.diagnosticsDir, file), JSON.stringify(this.redactor.value(data), null, 2), 'utf8');
    return `diagnostics/${file}`;
  }
}
