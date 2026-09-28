import type { Game } from '../../types/Game.js';
import type { CheckResult, QaError } from '../../types/QaResult.js';
import { combineCurrencyDetections, type CombinedCurrencyDetection, type CurrencyDetector } from '../detectors/CurrencyDetector.js';
import type { GameBrowserContext } from '../detectors/GameBrowserContext.js';
import { check } from '../TestResult.js';

/** UNKNOWN = the 1071 entry of the game lists no currencies at all, so nothing can be concluded. */
export type Declaration = 'DECLARED' | 'NOT_DECLARED' | 'UNKNOWN';

/** Compares a selected currency with the currencies declared by opType 1071 for the game. */
export function declaration(game: Game, currency: string): Declaration {
  if (game.currencies.length === 0 && !game.currencyAvailabilityKnown) return 'UNKNOWN';
  return game.currencies.includes(currency.toUpperCase()) ? 'DECLARED' : 'NOT_DECLARED';
}

export function compareCurrencies(game: Game, selected: readonly string[]): Record<string, Declaration> {
  return Object.fromEntries(selected.map((c) => [c, declaration(game, c)]));
}

/**
 * Decides which currencies are tested for a game:
 * - currency testing on: every selected currency (undeclared ones are marked, and only launched if allowed)
 * - currency testing off: a single currency (first selected one that is declared, else the first declared one)
 */
export function planCurrencies(game: Game, selected: readonly string[], testCurrencies: boolean): string[] {
  if (testCurrencies && selected.length) return [...selected];
  const declared = selected.find((c) => game.currencies.includes(c));
  const fallback = declared ?? game.currencies[0] ?? selected[0];
  return fallback ? [fallback] : [];
}

export interface CurrencyEvaluation {
  check: CheckResult;
  errors: QaError[];
  detection?: CombinedCurrencyDetection;
}

/** Runtime validation: runs the currency detectors on the loaded game and maps the outcome to a check. */
export class CurrencyTest {
  async run(context: GameBrowserContext, detectors: CurrencyDetector[], declared: Declaration): Promise<CurrencyEvaluation> {
    const results = await Promise.all(
      detectors.map((d) => d.detect(context).catch(() => ({ detector: d.name, status: 'NOT_APPLICABLE' as const, found: [], confidence: 'low' as const }))),
    );
    const detection = combineCurrencyDetections(results);
    return { ...evaluateCurrencyDetection(detection, context.currency, declared), detection };
  }
}

export function evaluateCurrencyDetection(detection: CombinedCurrencyDetection, currency: string, declared: Declaration): Omit<CurrencyEvaluation, 'detection'> {
  const prefix = declared === 'NOT_DECLARED' ? 'No declarada en 1071. ' : declared === 'UNKNOWN' ? '1071 no indica divisas para este juego. ' : '';
  const source: Partial<CheckResult> = { expected: currency };
  if (detection.detector) source.source = detection.detector;
  if (detection.found.length) source.detected = detection.found.join(', ');

  switch (detection.status) {
    case 'DETECTED':
      return { check: check('PASS', `${prefix}${currency} detectada (${detection.evidence ?? detection.detector})`, source), errors: [] };
    case 'CONFLICT': {
      const description = `${prefix}Se esperaba ${currency} pero el juego muestra ${detection.found.join(', ')}`;
      const strong = detection.confidence === 'high';
      return {
        check: check(strong ? 'FAIL' : 'REVIEW', description, source),
        errors: [{ step: 'currency', type: 'CURRENCY_MISMATCH', description: `${description} (${detection.evidence ?? ''})`, warning: !strong }],
      };
    }
    case 'NOT_APPLICABLE':
      return { check: check('SKIPPED', `${prefix}Sin detectores aplicables`, source), errors: [] };
    default:
      return { check: check('NOT_DETECTED', `${prefix}No se pudo detectar la divisa en el juego`, source), errors: [] };
  }
}
