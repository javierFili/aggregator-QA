import type { Request, Response } from 'express';
import path from 'node:path';
import type { Environment } from '../config/environment.js';
import { AggregatorError } from '../aggregator/AggregatorClient.js';
import type { CatalogService } from '../qa/CatalogService.js';
import { ConfigValidationError, parseCredentials, parseRunConfig } from '../qa/QaConfig.js';
import type { QaRun, QaRunner } from '../qa/QaRunner.js';
import { probeSessions } from '../qa/SessionProbe.js';
import type { ReportService } from '../reporting/ReportService.js';
import { onLog } from '../util/logger.js';
import { globalRedactor } from '../util/Redactor.js';

function errorResponse(res: Response, err: unknown): void {
  const message = globalRedactor.text((err as Error).message ?? String(err));
  const status = err instanceof ConfigValidationError ? 400 : err instanceof AggregatorError ? 502 : 500;
  res.status(status).json({ ok: false, error: message });
}

/** HTTP handlers. Business logic lives in CatalogService / QaRunner / ReportService. */
export class QaController {
  private readonly clients = new Set<Response>();
  private attachedRun: QaRun | undefined;

  constructor(
    private readonly env: Environment,
    private readonly catalog: CatalogService,
    private readonly runner: QaRunner,
    private readonly reports: ReportService,
  ) {
    onLog((entry) => this.broadcast('log', entry));
    setInterval(() => this.broadcastComment(), 20_000).unref();
  }

  settings = (_req: Request, res: Response): void => {
    res.json({
      defaultWorkers: this.env.defaultWorkers,
      maxWorkers: this.env.maxWorkers,
      requestTimeoutMs: this.env.requestTimeoutMs,
      browserTimeoutMs: this.env.browserTimeoutMs,
      readyTimeoutMs: this.env.defaultReadyTimeoutMs,
      headless: this.env.playwrightHeadless,
    });
  };

  loadCatalog = async (req: Request, res: Response): Promise<void> => {
    try {
      const credentials = parseCredentials((req.body ?? {}) as Record<string, unknown>);
      const catalog = await this.catalog.load(credentials);
      res.json({ ok: true, catalog });
    } catch (err) {
      errorResponse(res, err);
    }
  };

  testSession = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = parseRunConfig((req.body ?? {}) as Record<string, unknown>, this.env);
      const sample = (req.body as { sampleGameId?: unknown })?.sampleGameId;
      const sampleGameId = Number.isSafeInteger(Number(sample)) && sample !== undefined && sample !== '' ? Number(sample) : undefined;
      res.json({ ok: true, probe: await probeSessions(config, this.env.requestTimeoutMs, undefined, sampleGameId) });
    } catch (err) {
      errorResponse(res, err);
    }
  };

  startRun = (req: Request, res: Response): void => {
    try {
      const config = parseRunConfig((req.body ?? {}) as Record<string, unknown>, this.env);
      const run = this.runner.start(config);
      this.attach(run);
      res.status(202).json({ ok: true, run: run.summary() });
    } catch (err) {
      errorResponse(res, err);
    }
  };

  stopRun = (_req: Request, res: Response): void => {
    const run = this.runner.run;
    if (!run?.isActive) {
      res.status(409).json({ ok: false, error: 'No hay ninguna ejecución en curso.' });
      return;
    }
    this.runner.stop();
    res.json({ ok: true, run: run.summary() });
  };

  currentRun = (_req: Request, res: Response): void => {
    const run = this.runner.run;
    res.json({ ok: true, run: run?.summary() ?? null, results: run?.results ?? [] });
  };

  downloadReport = async (_req: Request, res: Response): Promise<void> => {
    const run = this.runner.run;
    if (!run) {
      res.status(404).json({ ok: false, error: 'Todavía no hay resultados para exportar.' });
      return;
    }
    try {
      const file = await this.reports.generate(run);
      res.download(file, path.basename(file));
    } catch (err) {
      errorResponse(res, err);
    }
  };

  /** Serves screenshots / diagnostics of the current run only, with strict path checks. */
  evidence = (req: Request, res: Response): void => {
    const run = this.runner.run;
    const kind = String(req.params.kind);
    const file = String(req.params.file);
    if (!run || !['screenshots', 'diagnostics'].includes(kind) || !/^[\w.-]+\.(png|json)$/.test(file)) {
      res.status(404).end();
      return;
    }
    res.sendFile(path.join(run.runDir, kind, file), { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  };

  events = (req: Request, res: Response): void => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    const run = this.runner.run;
    this.send(res, 'snapshot', { run: run?.summary() ?? null, results: run?.results ?? [] });
    req.on('close', () => this.clients.delete(res));
  };

  private attach(run: QaRun): void {
    if (this.attachedRun === run) return;
    this.attachedRun = run;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const progress = (): void => {
      // throttle progress updates to ~4/s
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        this.broadcast('progress', run.summary());
      }, 250);
    };
    run.on('state', (summary) => this.broadcast('state', summary));
    run.on('progress', progress);
    run.on('worker', progress);
    run.on('result', (result) => this.broadcast('result', result));
  }

  private send(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private broadcast(event: string, data: unknown): void {
    for (const client of this.clients) this.send(client, event, data);
  }

  private broadcastComment(): void {
    for (const client of this.clients) client.write(': keep-alive\n\n');
  }
}
