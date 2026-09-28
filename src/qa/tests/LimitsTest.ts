import { amountsEqual, formatAmount } from '../../util/amount.js';
import type { CheckResult, QaError } from '../../types/QaResult.js';
import type { ExpectedLimits } from '../QaConfig.js';
import type { GameBrowserContext } from '../detectors/GameBrowserContext.js';
import { combineLimitDetections, type CombinedLimit, type CombinedLimits, type LimitDetector, type LimitField } from '../detectors/LimitDetector.js';
import { check, skipped } from '../TestResult.js';

export interface LimitsEvaluation {
  min: CheckResult;
  default: CheckResult;
  max: CheckResult;
  errors: QaError[];
  detection?: CombinedLimits;
}

const LABEL: Record<LimitField, string> = { min: 'Apuesta mínima', default: 'Apuesta por defecto', max: 'Apuesta máxima' };

/** Compares one expected limit with what was detected. NOT_DETECTED is never turned into FAIL. */
export function compareLimit(field: LimitField, expected: number | undefined, detected: CombinedLimit | undefined): { check: CheckResult; error?: QaError } {
  if (expected === undefined) return { check: skipped('Sin valor esperado') };
  if (!detected) return { check: check('NOT_DETECTED', `${LABEL[field]} no detectada`, { expected: formatAmount(expected) }) };

  const extra: Partial<CheckResult> = { expected: formatAmount(expected), detected: formatAmount(detected.value), source: detected.detector };
  if (amountsEqual(expected, detected.value)) {
    return { check: check('PASS', `${LABEL[field]} ${formatAmount(detected.value)} (${detected.evidence})`, extra) };
  }
  // values that only differ by a ×100 factor are probably expressed in cents
  if (amountsEqual(expected * 100, detected.value) || amountsEqual(expected / 100, detected.value)) {
    return { check: check('REVIEW', `${LABEL[field]}: ${formatAmount(detected.value)} parece estar en otra unidad (céntimos) — ${detected.evidence}`, extra) };
  }
  const description = `${LABEL[field]}: esperado ${formatAmount(expected)}, detectado ${formatAmount(detected.value)} (${detected.evidence})`;
  if (detected.confidence === 'low') {
    return { check: check('REVIEW', `${description} [detección heurística]`, extra) };
  }
  return { check: check('FAIL', description, extra), error: { step: 'limits', type: 'LIMIT_MISMATCH', description } };
}

export class LimitsTest {
  async run(context: GameBrowserContext, detectors: LimitDetector[], expected: ExpectedLimits): Promise<LimitsEvaluation> {
    const results = await Promise.all(detectors.map((d) => d.detect(context).catch(() => ({ detector: d.name }))));
    const detection = combineLimitDetections(results);
    return { ...evaluateLimits(detection, expected), detection };
  }
}

export function evaluateLimits(detection: CombinedLimits, expected: ExpectedLimits): Omit<LimitsEvaluation, 'detection'> {
  const errors: QaError[] = [];
  const out = {} as Record<LimitField, CheckResult>;
  for (const field of ['min', 'default', 'max'] as const) {
    const { check: c, error } = compareLimit(field, expected[field], detection[field]);
    out[field] = c;
    if (error) errors.push(error);
  }
  return { min: out.min, default: out.default, max: out.max, errors };
}

export function hasExpectedLimits(expected: ExpectedLimits): boolean {
  return expected.min !== undefined || expected.default !== undefined || expected.max !== undefined;
}
