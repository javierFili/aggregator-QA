import type { CheckResult, CheckStatus, GameQaResult, OverallStatus } from '../types/QaResult.js';

export const check = (status: CheckStatus, detail?: string, extra: Partial<CheckResult> = {}): CheckResult => {
  const result: CheckResult = { status, ...extra };
  if (detail) result.detail = detail;
  return result;
};

export const skipped = (detail?: string): CheckResult => check('SKIPPED', detail);

const INCONCLUSIVE: ReadonlySet<CheckStatus> = new Set(['REVIEW', 'NOT_DETECTED']);
const NEUTRAL: ReadonlySet<CheckStatus> = new Set(['SKIPPED', 'NOT_DECLARED']);

/**
 * The single place where the overall verdict of a game × currency test is decided:
 * - any launch / limit / currency FAIL          → FAIL
 * - otherwise any REVIEW or NOT_DETECTED         → REVIEW
 * - launch not executed (skipped / not declared) → SKIPPED
 * - otherwise                                    → PASS
 */
export function computeOverall(result: Pick<GameQaResult, 'launch' | 'currencyCheck' | 'minLimit' | 'defaultLimit' | 'maxLimit'>): OverallStatus {
  const checks = [result.launch, result.currencyCheck, result.minLimit, result.defaultLimit, result.maxLimit];
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => INCONCLUSIVE.has(c.status))) return 'REVIEW';
  if (NEUTRAL.has(result.launch.status)) return 'SKIPPED';
  return 'PASS';
}

export interface RunCounters {
  PASS: number;
  FAIL: number;
  REVIEW: number;
  SKIPPED: number;
}

export function countResults(results: readonly GameQaResult[]): RunCounters {
  const counters: RunCounters = { PASS: 0, FAIL: 0, REVIEW: 0, SKIPPED: 0 };
  for (const r of results) counters[r.overall]++;
  return counters;
}
