import { AggregatorError } from '../aggregator/AggregatorClient.js';
import type { GameBrowserSession } from '../browser/GameBrowser.js';
import type { GameSnapshot } from '../browser/GameSnapshot.js';
import type { Game } from '../types/Game.js';
import type { CheckResult, GameQaResult, QaError } from '../types/QaResult.js';
import { globalRedactor } from '../util/Redactor.js';
import type { CombinedCurrencyDetection } from './detectors/CurrencyDetector.js';
import type { GameBrowserContext } from './detectors/GameBrowserContext.js';
import type { CombinedLimits } from './detectors/LimitDetector.js';
import type { ChainResult } from './launch/LaunchChainFollower.js';
import type { RunServices, StepListener } from './TestContext.js';
import { check, computeOverall, skipped } from './TestResult.js';
import { CurrencyTest, declaration, type Declaration } from './tests/CurrencyTest.js';
import { BrowserLaunchEvaluator, HttpLaunchTest, type LaunchEvaluation } from './tests/LaunchTest.js';
import { hasExpectedLimits, LimitsTest } from './tests/LimitsTest.js';

interface Evidence {
  chain?: ChainResult;
  snapshot?: GameSnapshot;
  currency?: CombinedCurrencyDetection;
  limits?: CombinedLimits;
}

/** Tests one game in one currency: session → HTTP launch chain → browser → currency → limits → evidence. */
export class GameTester {
  private readonly httpLaunch: HttpLaunchTest;
  private readonly browserEvaluator = new BrowserLaunchEvaluator();
  private readonly currencyTest = new CurrencyTest();
  private readonly limitsTest = new LimitsTest();

  constructor(private readonly services: RunServices) {
    this.httpLaunch = new HttpLaunchTest(services.follower);
  }

  async test(game: Game, currency: string, onStep: StepListener = () => undefined, workerId = 1): Promise<GameQaResult> {
    const { config } = this.services;
    const started = Date.now();
    const declaredAs = declaration(game, currency);
    const declared = declaredAs === 'DECLARED';
    const result: GameQaResult = {
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      currency,
      declared,
      launch: skipped(),
      currencyCheck: skipped(),
      minLimit: skipped(),
      defaultLimit: skipped(),
      maxLimit: skipped(),
      overall: 'SKIPPED',
      durationMs: 0,
      startedAt: new Date(started).toISOString(),
      errors: [],
    };

    // a game whose 1071 entry lists no currencies is tested anyway: the catalogue simply says nothing
    if (declaredAs === 'NOT_DECLARED' && !config.options.testUndeclaredCurrencies) {
      result.launch = skipped('Divisa no declarada en 1071');
      result.currencyCheck = check('NOT_DECLARED', `${currency} no está declarada para este juego en 1071`);
      result.durationMs = Date.now() - started;
      return result;
    }

    const tokens: string[] = [];
    const evidence: Evidence = {};
    const holder: { session?: GameBrowserSession } = {};
    try {
      await this.run(game, currency, declaredAs, result, evidence, tokens, onStep, (s) => (holder.session = s), workerId);
      result.overall = computeOverall(result);
      onStep('evidence', currency);
      await this.saveEvidence(result, evidence, holder.session);
    } catch (err) {
      result.launch = check('FAIL', `Error interno: ${(err as Error).message}`);
      result.errors.push({ step: 'internal', type: 'EXCEPTION', description: globalRedactor.text(`${(err as Error).message}\n${(err as Error).stack ?? ''}`).slice(0, 2000) });
      result.overall = computeOverall(result);
    } finally {
      await holder.session?.close();
      for (const t of tokens) globalRedactor.forget(t);
      result.durationMs = Date.now() - started;
    }
    return result;
  }

  private async run(
    game: Game,
    currency: string,
    declared: Declaration,
    result: GameQaResult,
    evidence: Evidence,
    tokens: string[],
    onStep: StepListener,
    keepSession: (s: GameBrowserSession) => void,
    workerId: number,
  ): Promise<void> {
    const { config, browser, detectors, timeouts } = this.services;
    const limitsWanted = config.options.testLimits && hasExpectedLimits(config.expectedLimits);

    // ---- Level 1: session + HTTP launch chain
    onStep('session', currency);
    const launchUrl = await this.createLaunchUrl(game, currency, tokens, result, workerId);
    if (!launchUrl) {
      this.markNotEvaluated(result, 'No evaluado: no se pudo crear la sesión (1050)', limitsWanted);
      return;
    }
    onStep('http-launch', currency);
    const http = await this.httpLaunch.run(launchUrl);
    evidence.chain = http.chain;
    let launch: LaunchEvaluation = http;
    addErrors(result, http.errors);

    // ---- Level 2: browser
    let context: GameBrowserContext | undefined;
    if (browser) {
      onStep('browser', currency);
      const browserUrl = await this.createLaunchUrl(game, currency, tokens, result, workerId);
      if (browserUrl) {
        const session = await browser.open(browserUrl, {
          mobile: game.device.length > 0 && !game.device.includes('desktop'),
          locale: config.lang,
          timeoutMs: timeouts.browserMs,
          settleMs: timeouts.settleMs,
          ...(this.services.hostHeaders ? { hostHeaders: this.services.hostHeaders } : {}),
          readyTimeoutMs: config.options.readyTimeoutMs,
          ...(config.options.testCurrencies ? { readyWhen: this.currencyVisible(game, currency) } : {}),
        });
        keepSession(session);
        evidence.snapshot = session.snapshot;
        const browserEval = this.browserEvaluator.evaluate(session.snapshot);
        addErrors(result, browserEval.errors);
        launch = combineLaunch(http, browserEval);
        context = { game, currency, lang: config.lang, snapshot: session.snapshot };
      }
    }
    result.launch = launch.check;

    // ---- Currency
    const currencyFromLaunch = launch.semanticError?.category === 'CURRENCY_ERROR' || http.semanticError?.category === 'CURRENCY_ERROR';
    if (result.playerCurrency && launch.check.status !== 'FAIL') {
      // the aggregator gave the QA player another currency (1053 ignores it on some partners): nothing to compare
      result.currencyCheck = check('REVIEW', `El agregador asignó ${result.playerCurrency} al jugador de prueba (se pidió ${currency})`, { expected: currency, detected: result.playerCurrency });
    } else if (currencyFromLaunch) {
      result.currencyCheck = check('FAIL', `El proveedor rechazó la divisa ${currency}`, { expected: currency });
    } else if (launch.check.status === 'FAIL') {
      result.currencyCheck = skipped('No evaluada: el lanzamiento falló');
    } else if (!config.options.testCurrencies) {
      result.currencyCheck = skipped('Prueba de divisas desactivada');
    } else if (!context) {
      result.currencyCheck = skipped('Requiere verificación en navegador');
    } else {
      onStep('currency', currency);
      const evaluation = await this.currencyTest.run(context, detectors.currencyDetectorsFor(game.provider), declared);
      result.currencyCheck = evaluation.check;
      addErrors(result, evaluation.errors);
      if (evaluation.detection) evidence.currency = evaluation.detection;
    }


    // ---- Limits
    if (!limitsWanted) return;
    if (launch.check.status === 'FAIL') {
      this.markLimits(result, skipped('No evaluado: el lanzamiento falló'));
    } else if (!context) {
      this.markLimits(result, skipped('Requiere verificación en navegador'));
    } else {
      onStep('limits', currency);
      const limits = await this.limitsTest.run(context, detectors.limitDetectorsFor(game.provider), config.expectedLimits);
      result.minLimit = limits.min;
      result.defaultLimit = limits.default;
      result.maxLimit = limits.max;
      addErrors(result, limits.errors);
      if (limits.detection) evidence.limits = limits.detection;
    }
  }

  /** "Finished loading" signal: the expected currency is visible in the game or in its network data. */
  private currencyVisible(game: Game, currency: string): (partial: Pick<GameSnapshot, 'frames' | 'responses'>) => Promise<boolean> {
    const detectors = this.services.detectors.currencyDetectorsFor(game.provider);
    return async (partial) => {
      const context: GameBrowserContext = {
        game,
        currency,
        lang: this.services.config.lang,
        snapshot: { launchUrl: '', finalUrl: '', consoleErrors: [], pageErrors: [], failedRequests: [], loadTimeMs: 0, ...partial },
      };
      for (const detector of detectors) {
        if ((await detector.detect(context)).status === 'DETECTED') return true;
      }
      return false;
    };
  }

  /** Creates a fresh 1050 session (registering the QA player first if needed) and returns the launch URL. */
  private async createLaunchUrl(game: Game, currency: string, tokens: string[], result: GameQaResult, workerId: number): Promise<string | undefined> {
    const { players } = this.services;
    try {
      const session = await players.createSession(currency, workerId);
      tokens.push(session.token);
      const assigned = players.assignedCurrency.get(session.username);
      if (assigned && assigned !== currency) result.playerCurrency = assigned;
      return session.launchUrl(game.id);
    } catch (err) {
      const error: QaError = {
        step: 'session',
        type: err instanceof AggregatorError ? (err.kind === 'TIMEOUT' ? 'TIMEOUT' : err.kind === 'NETWORK_ERROR' ? 'NETWORK_ERROR' : 'SEMANTIC_ERROR') : 'EXCEPTION',
        description: globalRedactor.text((err as Error).message),
      };
      if (err instanceof AggregatorError && err.httpStatus) error.httpStatus = err.httpStatus;
      result.errors.push(error);
      result.launch = check('FAIL', `Sesión (1050): ${error.description}`);
      return undefined;
    }
  }

  private markNotEvaluated(result: GameQaResult, detail: string, limitsWanted: boolean): void {
    result.currencyCheck = skipped(detail);
    if (limitsWanted) this.markLimits(result, skipped(detail));
  }

  private markLimits(result: GameQaResult, value: CheckResult): void {
    const { expectedLimits } = this.services.config;
    if (expectedLimits.min !== undefined) result.minLimit = value;
    if (expectedLimits.default !== undefined) result.defaultLimit = value;
    if (expectedLimits.max !== undefined) result.maxLimit = value;
  }

  private async saveEvidence(result: GameQaResult, evidence: Evidence, session: GameBrowserSession | undefined): Promise<void> {
    const { config, evidence: writer, log } = this.services;
    const problematic = result.overall === 'FAIL' || result.overall === 'REVIEW';
    try {
      if (session && ((problematic && config.options.screenshotsOnFailure) || config.options.screenshotsAll)) {
        const target = writer.screenshotPath(result.gameId, result.currency);
        if (await session.screenshot(target.absolute)) result.screenshot = target.relative;
      }
      if (problematic || config.options.screenshotsAll) {
        result.diagnostics = await writer.writeDiagnostics(result.gameId, result.currency, buildDiagnostics(result, evidence));
      }
    } catch (err) {
      log.warn(`No se pudo guardar la evidencia de ${result.gameId}/${result.currency}: ${(err as Error).message}`);
    }
  }
}

/** Appends errors, skipping exact duplicates (HTTP and browser levels often see the same provider error). */
function addErrors(result: GameQaResult, errors: readonly QaError[]): void {
  for (const e of errors) {
    const duplicate = result.errors.some((x) => x.step === e.step && x.type === e.type && x.description === e.description && x.url === e.url);
    if (!duplicate) result.errors.push(e);
  }
}

/**
 * HTTP and browser verdicts combined:
 * - an explicit semantic error on the HTTP chain is always FAIL
 * - otherwise the browser has the final word, except that an HTTP-only failure that the browser does not reproduce becomes REVIEW
 */
export function combineLaunch(http: LaunchEvaluation, browser: LaunchEvaluation): LaunchEvaluation {
  if (http.check.status === 'FAIL') {
    if (http.semanticError || browser.check.status === 'FAIL') return http.semanticError ? http : browser;
    return { ...browser, check: check('REVIEW', `La cadena HTTP falló (${http.check.detail ?? ''}) pero el juego cargó en el navegador`) };
  }
  if (browser.check.status === 'PASS' && http.check.status === 'REVIEW') {
    return { ...browser, check: check('PASS', `${browser.check.detail ?? ''} — cadena HTTP no concluyente`) };
  }
  return browser;
}

function buildDiagnostics(result: GameQaResult, evidence: Evidence): Record<string, unknown> {
  const snapshot = evidence.snapshot;
  return {
    gameId: result.gameId,
    gameName: result.gameName,
    provider: result.provider,
    currency: result.currency,
    declaredIn1071: result.declared,
    overall: result.overall,
    checks: {
      launch: result.launch,
      currency: result.currencyCheck,
      minLimit: result.minLimit,
      defaultLimit: result.defaultLimit,
      maxLimit: result.maxLimit,
    },
    errors: result.errors,
    httpChain: evidence.chain,
    browser: snapshot && {
      launchUrl: snapshot.launchUrl,
      finalUrl: snapshot.finalUrl,
      mainStatus: snapshot.mainStatus,
      navigationError: snapshot.navigationError,
      loadTimeMs: snapshot.loadTimeMs,
      frames: snapshot.frames.map((f) => ({
        url: f.url,
        depth: f.depth,
        elementCount: f.elementCount,
        visibleCanvasCount: f.visibleCanvasCount,
        videoCount: f.videoCount,
        iframeCount: f.iframeCount,
        textExcerpt: f.text.slice(0, 600),
        betElements: f.betElements.slice(0, 20),
        ariaElements: f.ariaElements.slice(0, 20),
        error: f.error,
      })),
      documents: snapshot.responses.filter((r) => r.isNavigation).map((r) => ({ url: r.url, status: r.status, contentType: r.contentType, json: r.json, excerpt: r.excerpt })),
      failedResponses: snapshot.responses.filter((r) => !r.isNavigation && r.status >= 400).map((r) => ({ url: r.url, status: r.status })),
      jsonResponses: snapshot.responses.filter((r) => r.json !== undefined && !r.isNavigation).map((r) => r.url),
      consoleErrors: snapshot.consoleErrors,
      pageErrors: snapshot.pageErrors,
      failedRequests: snapshot.failedRequests,
    },
    detection: {
      currency: evidence.currency,
      limits: evidence.limits,
    },
  };
}
