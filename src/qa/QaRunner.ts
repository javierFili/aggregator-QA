import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AggregatorClient, type FetchLike } from '../aggregator/AggregatorClient.js';
import { GameService } from '../aggregator/GameService.js';
import { ProviderService } from '../aggregator/ProviderService.js';
import { PlayerProvisioner } from '../aggregator/PlayerProvisioner.js';
import type { BrowserManager } from '../browser/BrowserManager.js';
import { GameBrowser } from '../browser/GameBrowser.js';
import type { Game } from '../types/Game.js';
import type { Provider } from '../types/Provider.js';
import type { GameQaResult } from '../types/QaResult.js';
import { createLogger } from '../util/logger.js';
import { globalRedactor } from '../util/Redactor.js';
import { fileTimestamp } from '../util/time.js';
import { createDefaultDetectorRegistry, type DetectorRegistry } from './detectors/DetectorRegistry.js';
import { EvidenceWriter } from './EvidenceWriter.js';
import { GameTester } from './GameTester.js';
import { LaunchChainFollower } from './launch/LaunchChainFollower.js';
import type { QaRunConfig } from './QaConfig.js';
import type { ProgressStep } from './TestContext.js';
import { countResults, type RunCounters } from './TestResult.js';
import { planCurrencies } from './tests/CurrencyTest.js';
import { WorkerPool } from './WorkerPool.js';

export type RunState = 'idle' | 'loading' | 'running' | 'stopping' | 'finished' | 'stopped' | 'failed';

export interface WorkerStatus {
  workerId: number;
  gameId?: number;
  gameName?: string;
  provider?: string;
  currency?: string;
  step?: ProgressStep | 'idle';
  since?: string;
}

/** Public, secret-free view of the run configuration (used by UI and report). */
export interface PublicRunConfig {
  aggregatorUrl: string;
  launcherUrl: string;
  partnerCode: string;
  /** Player naming prefix and existing players (never passwords / md5). */
  players: { prefix: string; existing: string[] };
  currencies: string[];
  lang: string;
  workers: number;
  expectedLimits: QaRunConfig['expectedLimits'];
  options: QaRunConfig['options'];
  filters: QaRunConfig['filters'];
}

export interface RunSummary {
  id: string;
  state: RunState;
  config: PublicRunConfig;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  providers: Provider[];
  gamesDiscovered: number;
  gamesQueued: number;
  gamesCompleted: number;
  testsCompleted: number;
  counters: RunCounters;
  workers: WorkerStatus[];
  runDir: string;
  error?: string;
  stopRequested: boolean;
}

export interface QaRunnerDeps {
  browserManager: BrowserManager;
  reportsDir: string;
  requestTimeoutMs: number;
  browserTimeoutMs: number;
  settleTimeoutMs: number;
  fetchImpl?: FetchLike;
  detectors?: DetectorRegistry;
}

export interface QaRunnerEvents {
  state: [RunSummary];
  progress: [RunSummary];
  worker: [WorkerStatus];
  result: [GameQaResult];
}

/** Selects the games to test from the 1071 catalogue according to the run filters. */
export function selectGames(games: readonly Game[], filters: QaRunConfig['filters']): Game[] {
  const providers = new Set(filters.providers.map((p) => p.toLowerCase()));
  const ids = new Set(filters.gameIds);
  let selected = games.filter((g) => (!providers.size || providers.has(g.provider.toLowerCase())) && (!ids.size || ids.has(g.id)));
  if (filters.maxGames > 0) selected = selected.slice(0, filters.maxGames);
  return selected;
}

/** One QA run: loads 1070/1071, builds the queue and drives the worker pool. Holds state in memory only. */
export class QaRun extends EventEmitter<QaRunnerEvents> {
  readonly id: string;
  readonly results: GameQaResult[] = [];
  readonly startedAt = new Date();
  private finishedAt: Date | undefined;
  private state: RunState = 'idle';
  private providers: Provider[] = [];
  private gamesDiscovered = 0;
  private queue: Game[] = [];
  private gamesCompleted = 0;
  private readonly workers = new Map<number, WorkerStatus>();
  private pool: WorkerPool<Game> | undefined;
  private stopRequested = false;
  private error: string | undefined;
  readonly runDir: string;
  private readonly log = createLogger('runner');
  private done: Promise<void> | undefined;

  constructor(
    private config: QaRunConfig | undefined,
    private readonly deps: QaRunnerDeps,
  ) {
    super();
    this.id = fileTimestamp(this.startedAt);
    this.runDir = path.join(deps.reportsDir, this.id);
    this.publicConfig = toPublicConfig(config!);
  }

  readonly publicConfig: PublicRunConfig;

  get isActive(): boolean {
    return this.state === 'loading' || this.state === 'running' || this.state === 'stopping';
  }

  /** Starts the run in the background. Resolves when the run is completely finished. */
  start(): Promise<void> {
    this.done ??= this.execute();
    return this.done;
  }

  wait(): Promise<void> {
    return this.done ?? Promise.resolve();
  }

  stop(): void {
    if (!this.isActive || this.stopRequested) return;
    this.stopRequested = true;
    this.log.warn('STOP REQUESTED — no new games will be started; waiting for running tests to finish');
    this.pool?.stop();
    if (this.state === 'running') this.setState('stopping');
    else this.emit('state', this.summary());
  }

  summary(): RunSummary {
    const end = this.finishedAt ?? new Date();
    const summary: RunSummary = {
      id: this.id,
      state: this.state,
      config: this.publicConfig,
      startedAt: this.startedAt.toISOString(),
      durationMs: end.getTime() - this.startedAt.getTime(),
      providers: this.providers,
      gamesDiscovered: this.gamesDiscovered,
      gamesQueued: this.queue.length,
      gamesCompleted: this.gamesCompleted,
      testsCompleted: this.results.length,
      counters: countResults(this.results),
      workers: [...this.workers.values()].sort((a, b) => a.workerId - b.workerId),
      runDir: this.runDir,
      stopRequested: this.stopRequested,
    };
    if (this.finishedAt) summary.finishedAt = this.finishedAt.toISOString();
    if (this.error) summary.error = this.error;
    return summary;
  }

  private setState(state: RunState): void {
    this.state = state;
    this.emit('state', this.summary());
  }

  private async execute(): Promise<void> {
    const config = this.config!;
    const { deps, log } = this;
    this.setState('loading');
    let client: AggregatorClient | undefined;
    try {
      const options: ConstructorParameters<typeof AggregatorClient>[0] = {
        baseUrl: config.aggregatorUrl,
        partnerCode: config.partnerCode,
        apiKey: config.apiKey,
        timeoutMs: deps.requestTimeoutMs,
      };
      if (config.launcherUrl) options.launcherUrl = config.launcherUrl;
      if (deps.fetchImpl) options.fetchImpl = deps.fetchImpl;
      client = new AggregatorClient(options);

      log.info('Loading providers...');
      this.providers = await new ProviderService(client).getProviders();
      log.info(`${this.providers.length} providers loaded`);
      log.info('Loading games...');
      const gameService = new GameService(client);
      const games = await gameService.getGames();
      this.gamesDiscovered = games.length;
      log.info(`${games.length} games discovered`);
      if (games.length && games.every((g) => g.currencies.length === 0) && config.currencies.length) {
        await this.loadAvailabilityPerCurrency(gameService, games, config.currencies);
      }

      this.queue = selectGames(games, config.filters);
      this.warnAboutCurrencies(this.queue, config.currencies);
      const evidence = new EvidenceWriter(this.runDir);
      await mkdir(this.runDir, { recursive: true });
      await evidence.init();

      const players = new PlayerProvisioner(client, {
        apiKey: config.apiKey,
        lang: config.lang,
        runDate: this.startedAt,
        log,
        ...(config.players.prefix ? { prefix: config.players.prefix } : {}),
        ...(config.players.existing ? { existing: config.players.existing } : {}),
      });
      const hostHeaders = accessHeaders(config);
      await this.prepareSessions(players, config, hostHeaders?.headers ?? {});

      const followerOptions: ConstructorParameters<typeof LaunchChainFollower>[0] = { timeoutMs: deps.requestTimeoutMs, acceptLanguage: config.lang };
      if (hostHeaders) followerOptions.hostHeaders = hostHeaders;
      if (deps.fetchImpl) followerOptions.fetchImpl = deps.fetchImpl;
      const services = {
        config,
        client,
        players,
        ...(hostHeaders ? { hostHeaders } : {}),
        follower: new LaunchChainFollower(followerOptions),
        detectors: deps.detectors ?? createDefaultDetectorRegistry(),
        evidence,
        timeouts: { browserMs: deps.browserTimeoutMs, settleMs: deps.settleTimeoutMs },
        log,
        ...(config.options.browserCheck ? { browser: new GameBrowser(deps.browserManager) } : {}),
      };
      const tester = new GameTester(services);

      if (this.stopRequested) {
        this.finish('stopped');
        return;
      }
      this.setState('running');
      log.info(`${this.queue.length} games queued · currencies: ${config.currencies.join(', ') || '(declared)'} · starting ${Math.min(config.workers, this.queue.length)} workers`);

      this.pool = new WorkerPool<Game>({ concurrency: config.workers });
      if (this.stopRequested) this.pool.stop();
      await this.pool.run(
        this.queue,
        async (game, workerId) => {
          const wlog = log.child(`Worker ${String(workerId).padStart(2, '0')}`);
          wlog.info(`Testing ${game.name} (${game.id})`);
          const currencies = planCurrencies(game, config.currencies, config.options.testCurrencies);
          if (!currencies.length) wlog.warn(`${game.name} (${game.id}) has no currency to test`);
          for (const currency of currencies) {
            this.updateWorker({ workerId, gameId: game.id, gameName: game.name, provider: game.provider, currency, step: 'session', since: new Date().toISOString() });
            const result = await tester.test(game, currency, (step) => this.updateWorker({ ...this.workers.get(workerId)!, step }), workerId);
            this.results.push(result);
            this.checkSessionHealth(result);
            const why = result.overall === 'SKIPPED' ? ` (${result.launch.detail ?? result.currencyCheck.detail ?? 'no probado'})` : '';
            wlog.info(`${game.name} (${game.id}) ${currency} → launch ${result.launch.status} · result ${result.overall}${why} · ${result.durationMs} ms`);
            this.emit('result', result);
            this.emit('progress', this.summary());
          }
          this.gamesCompleted++;
          this.updateWorker({ workerId, step: 'idle' });
          this.emit('progress', this.summary());
        },
        (err, game) => log.error(`Unexpected error testing ${game.id}: ${(err as Error).message}`),
      );
      if (!this.error && this.sessionSuccesses === 0 && this.lastSessionError) {
        this.error = this.sessionErrorMessage(this.lastSessionError);
        log.error(this.error);
      }
      this.finish(this.error ? 'failed' : this.stopRequested ? 'stopped' : 'finished');
    } catch (err) {
      this.error = (err as Error).message;
      log.error(`Run failed: ${this.error}`);
      this.finish('failed');
    } finally {
      await deps.browserManager.closeAllContexts();
      // drop the only reference to the API key held by this run
      client = undefined;
      this.config = undefined;
    }
  }

  /**
   * Before the workers start: log in (registering the QA player if needed) and find out which launcher this partner
   * uses, with the first queued game. A failure here is reported per game by the normal flow and the circuit breaker.
   */
  private async prepareSessions(players: PlayerProvisioner, config: QaRunConfig, headers: Record<string, string>): Promise<void> {
    const first = this.queue[0];
    const currency = first ? (config.currencies.find((c) => first.currencies.includes(c)) ?? config.currencies[0] ?? first.currencies[0]) : undefined;
    if (!first || !currency) return;
    try {
      const mode = await players.detectLaunchMode(first.id, currency, this.deps.fetchImpl ?? fetch, this.deps.requestTimeoutMs, headers);
      if (players.detectionBlockedByWaf) {
        this.log.warn(`Cloudflare muestra su verificación anti-bot al abrir ${first.name} (${first.id}). Si todos los juegos salen «Bloqueado por Cloudflare», pide que permitan a la herramienta (ver «Cabecera de acceso» en Opciones avanzadas).`);
      }
      this.log.info(
        mode === 'front'
          ? 'Launcher: este partner usa sesiones de sitio → se abrirán los juegos con /front/launcher/{juego}/{token}'
          : 'Launcher: /{partner}/launch/{juego}/{token} (el documentado)',
      );
    } catch (err) {
      this.log.warn(`No se pudo preparar la sesión de prueba: ${(err as Error).message}`);
    }
  }

  /**
   * When 1071 does not list currencies per game, ask 1071 once per selected currency (documented optional
   * `currency` parameter) and mark each game with the currencies it is returned for.
   */
  private async loadAvailabilityPerCurrency(service: GameService, games: Game[], currencies: readonly string[]): Promise<void> {
    const byId = new Map(games.map((g) => [g.id, g]));
    for (const currency of currencies) {
      try {
        const available = await service.getGames(currency);
        let count = 0;
        for (const g of available) {
          const game = byId.get(g.id);
          if (game && !game.currencies.includes(currency)) {
            game.currencies.push(currency);
            count++;
          }
        }
        for (const game of games) game.currencyAvailabilityKnown = true;
        this.log.info(`1071 con divisa ${currency}: ${count} juegos disponibles`);
      } catch (err) {
        this.log.warn(`1071 con divisa ${currency} falló: ${(err as Error).message}`);
      }
    }
  }

  private sessionFailures = 0;
  private lastSessionError: string | undefined;

  private wafBlocked = 0;
  private reachedGame = 0;

  /** If Cloudflare blocks the first games and none is reached, stop: every result would be meaningless. */
  private checkWafHealth(result: GameQaResult): void {
    const blocked = result.errors.some((e) => e.type === 'WAF_BLOCKED') && result.launch.status !== 'PASS';
    if (blocked) this.wafBlocked++;
    else this.reachedGame++;
    if (this.reachedGame === 0 && this.wafBlocked >= 4 && !this.stopRequested) {
      this.error =
        'Cloudflare bloquea a la herramienta con su verificación anti-bot («Performing security verification») antes de llegar a los juegos, así que no se puede saber si funcionan. ' +
        'Solución: pide al equipo que tenga acceso a Cloudflare que cree una regla que permita a la herramienta (por la IP de este ordenador, o por una cabecera secreta) y, si es por cabecera, ponla en Opciones avanzadas → «Cabecera de acceso». Ejecución detenida.';
      this.log.error(this.error);
      this.stopRequested = true;
      this.pool?.stop();
      this.setState('stopping');
    }
  }

  private sessionErrorMessage(description: string): string {
    return `El agregador rechaza la creación de sesión (1050): «${description.replace(/^opType \d+: /, '')}». Los jugadores de prueba no se pudieron registrar (1053) ni iniciar sesión: revisa la API Key / el endpoint, o usa «Jugadores existentes» en Opciones avanzadas.`;
  }
  private sessionSuccesses = 0;

  /**
   * Circuit breaker: if the very first sessions (1050) all fail, the configuration is wrong
   * (e.g. invalid md5 / player). Stop instead of marking the whole catalogue as FAIL.
   */
  private checkSessionHealth(result: GameQaResult): void {
    if (result.launch.status === 'SKIPPED') return;
    const sessionError = result.errors.find((e) => e.step === 'session');
    if (!sessionError) {
      this.sessionSuccesses++;
      this.checkWafHealth(result);
      return;
    }
    this.sessionFailures++;
    this.lastSessionError = sessionError.description;
    if (this.sessionSuccesses === 0 && this.sessionFailures >= 5 && !this.stopRequested) {
      this.error = `${this.sessionErrorMessage(sessionError.description)} Ejecución detenida para no marcar todos los juegos como FAIL.`;
      this.log.error(this.error);
      this.stopRequested = true;
      this.pool?.stop();
      this.setState('stopping');
    }
  }

  /** Makes a catalogue/selection mismatch obvious in the log instead of silently skipping everything. */
  private warnAboutCurrencies(games: readonly Game[], selected: readonly string[]): void {
    if (!games.length) {
      this.log.warn('No hay juegos que probar con los filtros elegidos');
      return;
    }
    const withoutCurrencies = games.filter((g) => g.currencies.length === 0).length;
    if (withoutCurrencies) {
      this.log.warn(`${withoutCurrencies}/${games.length} juegos no indican divisas en 1071: se probarán igualmente con las divisas elegidas`);
    }
    for (const currency of selected) {
      const declaring = games.filter((g) => g.currencies.includes(currency)).length;
      this.log.info(`${currency}: declarada en 1071 por ${declaring}/${games.length} juegos`);
    }
    const declaredAny = new Set(games.flatMap((g) => g.currencies));
    if (selected.length && declaredAny.size && !selected.some((c) => declaredAny.has(c))) {
      this.log.warn(`Ninguna divisa elegida (${selected.join(', ')}) aparece en 1071. Divisas del catálogo: ${[...declaredAny].slice(0, 15).join(', ')}. Los juegos se marcarán SKIPPED salvo que actives «Probar divisas no declaradas en 1071».`);
    }
  }

  private finish(state: RunState): void {
    this.finishedAt = new Date();
    this.workers.clear();
    const c = countResults(this.results);
    this.log.info(`Run ${state}: ${this.gamesCompleted}/${this.queue.length} games · PASS ${c.PASS} · FAIL ${c.FAIL} · REVIEW ${c.REVIEW} · SKIPPED ${c.SKIPPED}`);
    this.setState(state);
  }

  private updateWorker(status: WorkerStatus): void {
    this.workers.set(status.workerId, status);
    this.emit('worker', status);
  }
}

/** Access header for the aggregator's own hosts only (endpoint + launcher). */
function accessHeaders(config: QaRunConfig): { hosts: string[]; headers: Record<string, string> } | undefined {
  if (!config.accessHeader) return undefined;
  globalRedactor.register(config.accessHeader.value);
  const hosts = [...new Set([config.aggregatorUrl, config.launcherUrl].filter((u): u is string => !!u).map((u) => new URL(u).hostname))];
  return { hosts, headers: { [config.accessHeader.name]: config.accessHeader.value } };
}

function toPublicConfig(config: QaRunConfig): PublicRunConfig {
  return {
    aggregatorUrl: config.aggregatorUrl,
    launcherUrl: config.launcherUrl ?? config.aggregatorUrl,
    partnerCode: config.partnerCode,
    players: { prefix: config.players.prefix ?? 'qa-runner', existing: Object.entries(config.players.existing ?? {}).map(([c, p]) => `${c}: ${p.username}`) },
    currencies: config.currencies,
    lang: config.lang,
    workers: config.workers,
    expectedLimits: config.expectedLimits,
    options: config.options,
    filters: config.filters,
  };
}

/** Keeps the current (single) run. Only one run may be active at a time. */
export class QaRunner {
  private current: QaRun | undefined;

  constructor(private readonly deps: QaRunnerDeps) {}

  get run(): QaRun | undefined {
    return this.current;
  }

  start(config: QaRunConfig): QaRun {
    if (this.current?.isActive) throw new Error('Ya hay una ejecución en curso.');
    const run = new QaRun(config, this.deps);
    this.current = run;
    void run.start();
    return run;
  }

  stop(): void {
    this.current?.stop();
  }
}
