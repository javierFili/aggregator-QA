import type { GameSnapshot } from '../../browser/GameSnapshot.js';
import type { CheckResult, QaError, QaErrorType, QaStep } from '../../types/QaResult.js';
import { SemanticErrorDetector, semanticErrorDetector, type SemanticError } from '../detectors/SemanticErrorDetector.js';
import type { ChainOutcome, ChainResult, LaunchChainFollower } from '../launch/LaunchChainFollower.js';
import { check } from '../TestResult.js';
import { isWafChallenge, WAF_DESCRIPTION } from '../detectors/WafDetector.js';

export interface LaunchEvaluation {
  check: CheckResult;
  errors: QaError[];
  semanticError?: SemanticError;
}

const OUTCOME_TYPE: Record<Exclude<ChainOutcome, 'LOADED'>, QaErrorType> = {
  SEMANTIC_ERROR: 'SEMANTIC_ERROR',
  HTTP_ERROR: 'HTTP_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  EMPTY: 'EMPTY_CONTENT',
  WAF_BLOCKED: 'WAF_BLOCKED',
  UNKNOWN_CONTENT: 'INVALID_RESPONSE',
  TOO_MANY_HOPS: 'INVALID_RESPONSE',
};

/** Level 1: HTTP launch chain. HTTP 200 alone is never success — the chain must end in an application page without semantic errors. */
export class HttpLaunchTest {
  constructor(private readonly follower: LaunchChainFollower) {}

  async run(launchUrl: string): Promise<LaunchEvaluation & { chain: ChainResult }> {
    const chain = await this.follower.follow(launchUrl);
    return { chain, ...evaluateChain(chain) };
  }
}

export function evaluateChain(chain: ChainResult): LaunchEvaluation {
  if (chain.outcome === 'LOADED') {
    return { check: check('PASS', chain.description), errors: [] };
  }
  const hop = chain.hops[chain.failedHop ?? chain.hops.length - 1];
  const step: QaStep = !hop || hop.index === 0 ? 'launch' : hop.via === 'redirect' ? 'redirect' : 'provider-launch';
  const error: QaError = { step, type: OUTCOME_TYPE[chain.outcome], description: chain.description };
  if (hop?.status !== undefined) error.httpStatus = hop.status;
  if (hop?.url) error.url = hop.url;
  if (hop?.contentType) error.contentType = hop.contentType;
  if (chain.semanticError?.code !== undefined) error.code = chain.semanticError.code;

  // an empty final page or unknown content is suspicious but not conclusive
  // an empty final page, unknown content or an anti-bot wall is not conclusive about the game
  const status = chain.outcome === 'EMPTY' || chain.outcome === 'UNKNOWN_CONTENT' || chain.outcome === 'WAF_BLOCKED' ? 'REVIEW' : 'FAIL';
  const evaluation: LaunchEvaluation = {
    check: check(status, `${stepLabel(step)}: ${chain.description}`),
    errors: [status === 'REVIEW' ? { ...error, warning: true } : error],
  };
  if (chain.semanticError) evaluation.semanticError = chain.semanticError;
  return evaluation;
}

function stepLabel(step: QaStep): string {
  return step === 'launch' ? 'Lanzamiento' : step === 'redirect' ? 'Redirección' : 'Lanzamiento del proveedor';
}

/** Level 2: decides whether the game actually loaded in the browser. */
export class BrowserLaunchEvaluator {
  constructor(private readonly detector: SemanticErrorDetector = semanticErrorDetector) {}

  evaluate(snapshot: GameSnapshot): LaunchEvaluation {
    const errors: QaError[] = [];

    // Anti-bot wall (Cloudflare…) still showing after the wait: the game was never reached
    const loadedSomewhere = snapshot.frames.some((f) => f.visibleCanvasCount > 0 || f.videoCount > 0);
    const blocked = snapshot.frames.some((f) => isWafChallenge({ url: f.url, text: f.text }));
    if (blocked && !loadedSomewhere) {
      errors.push({ step: 'browser', type: 'WAF_BLOCKED', description: WAF_DESCRIPTION, url: snapshot.launchUrl, ...(snapshot.mainStatus ? { httpStatus: snapshot.mainStatus } : {}), warning: true });
      return { check: check('REVIEW', `Navegador: ${WAF_DESCRIPTION}`), errors };
    }

    if (snapshot.navigationError) {
      const timeout = /timeout/i.test(snapshot.navigationError);
      errors.push({ step: 'browser', type: timeout ? 'TIMEOUT' : 'BROWSER_ERROR', description: snapshot.navigationError, url: snapshot.launchUrl });
      return { check: check('FAIL', `Navegador: ${snapshot.navigationError}`), errors };
    }
    if (snapshot.mainStatus !== undefined && snapshot.mainStatus >= 400) {
      errors.push({ step: 'browser', type: 'HTTP_ERROR', httpStatus: snapshot.mainStatus, url: snapshot.launchUrl, description: `HTTP ${snapshot.mainStatus} al abrir el juego` });
      return { check: check('FAIL', `Navegador: HTTP ${snapshot.mainStatus}`), errors };
    }

    // Documents loaded in frames that are JSON errors (e.g. provider launch returning {"error":...})
    for (const response of snapshot.responses) {
      if (!response.isNavigation) continue;
      const semantic =
        response.json !== undefined ? this.detector.detectJson(response.json) : response.excerpt ? this.detector.detectText(response.excerpt) : undefined;
      if (semantic) {
        const error: QaError = {
          step: 'provider-launch',
          type: 'SEMANTIC_ERROR',
          description: semantic.description,
          httpStatus: response.status,
          url: response.url,
          contentType: response.contentType,
        };
        if (semantic.code !== undefined) error.code = semantic.code;
        errors.push(error);
        return { check: check('FAIL', `Navegador: ${semantic.description}`), errors, semanticError: semantic };
      }
    }

    // Small frames showing an error message
    for (const frame of snapshot.frames) {
      if (frame.visibleCanvasCount > 0 || frame.elementCount > 60 || !frame.text) continue;
      const semantic = frame.text.length <= 2000 ? this.detector.detectText(frame.text) : undefined;
      if (semantic && semantic.category !== 'GENERIC') {
        errors.push({ step: 'browser', type: 'SEMANTIC_ERROR', description: semantic.description, url: frame.url });
        return { check: check('FAIL', `Navegador: ${semantic.description}`), errors, semanticError: semantic };
      }
    }

    // Failed document navigations inside frames: warn, and fail only if nothing else loaded
    const failedDocs = snapshot.responses.filter((r) => r.isNavigation && r.status >= 400);
    for (const doc of failedDocs) {
      errors.push({ step: 'browser', type: 'HTTP_ERROR', httpStatus: doc.status, url: doc.url, description: `Documento de frame con HTTP ${doc.status}`, warning: true });
    }
    for (const message of snapshot.pageErrors.slice(0, 5)) {
      errors.push({ step: 'browser', type: 'BROWSER_ERROR', description: `Excepción JS: ${message}`, warning: true });
    }

    const loaded = snapshot.frames.some((f) => f.visibleCanvasCount > 0 || f.videoCount > 0 || (f.elementCount >= 30 && !f.isMain) || f.text.length >= 100);
    const deepest = Math.max(0, ...snapshot.frames.map((f) => f.depth));
    if (loaded) {
      const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
      const ready = snapshot.ready
        ? snapshot.ready.reason === 'signal'
          ? `listo a los ${secs(snapshot.ready.afterMs)} (divisa visible)`
          : snapshot.ready.reason === 'quiet'
            ? `listo a los ${secs(snapshot.ready.afterMs)} (carga terminada)`
            : `sin señal de fin de carga tras ${secs(snapshot.ready.afterMs)}`
        : `carga: ${secs(snapshot.loadTimeMs)}`;
      const details = [ready, `frames: ${snapshot.frames.length}`, `profundidad: ${deepest}`];
      return { check: check('PASS', `Juego cargado (${details.join(', ')})`), errors };
    }
    if (failedDocs.length) {
      for (const e of errors) if (e.type === 'HTTP_ERROR') e.warning = false;
      return { check: check('FAIL', `Navegador: frame del juego con HTTP ${failedDocs[0]!.status}`), errors };
    }
    errors.push({ step: 'browser', type: 'EMPTY_CONTENT', description: 'No se detectó contenido del juego (sin canvas, vídeo ni DOM significativo)', url: snapshot.finalUrl, warning: true });
    return { check: check('REVIEW', 'Navegador: no se detectó contenido del juego'), errors };
  }
}
