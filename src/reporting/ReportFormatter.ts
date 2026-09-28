import type { CheckResult, CheckStatus, GameQaResult, OverallStatus } from '../types/QaResult.js';
import { formatDuration } from '../util/time.js';

export const STATUS_LABEL: Record<CheckStatus | OverallStatus, string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REVIEW: 'REVIEW',
  SKIPPED: 'SKIPPED',
  NOT_DECLARED: 'NOT_DECLARED',
  NOT_DETECTED: 'NOT_DETECTED',
};

/** ARGB fill / font colours for status cells. */
export const STATUS_STYLE: Record<string, { fill: string; font: string }> = {
  PASS: { fill: 'FFD1E7DD', font: 'FF0A3622' },
  FAIL: { fill: 'FFF8D7DA', font: 'FF58151C' },
  REVIEW: { fill: 'FFFFF3CD', font: 'FF664D03' },
  NOT_DETECTED: { fill: 'FFFFF3CD', font: 'FF664D03' },
  SKIPPED: { fill: 'FFE2E3E5', font: 'FF2B2F32' },
  NOT_DECLARED: { fill: 'FFE2E3E5', font: 'FF2B2F32' },
};

/** "PASS", or "FAIL (esperado 0.10, detectado 0.20)" style short cell text for a limit check. */
export function limitCell(checkResult: CheckResult): string {
  if (checkResult.status === 'SKIPPED') return 'SKIPPED';
  const parts: string[] = [];
  if (checkResult.expected !== undefined) parts.push(`esp. ${checkResult.expected}`);
  if (checkResult.detected !== undefined) parts.push(`det. ${checkResult.detected}`);
  return parts.length ? `${checkResult.status} (${parts.join(' / ')})` : checkResult.status;
}

export function statusOf(cellText: string): string {
  return cellText.split(' ')[0] ?? cellText;
}

/** First blocking error (or the check detail) summarising why a game did not pass. */
export function mainError(result: GameQaResult): string {
  const blocking = result.errors.find((e) => !e.warning) ?? result.errors[0];
  if (blocking) return `[${blocking.step}] ${blocking.description}`.slice(0, 500);
  if (result.overall === 'PASS') return '';
  for (const c of [result.launch, result.currencyCheck, result.minLimit, result.defaultLimit, result.maxLimit]) {
    if (c.status !== 'PASS' && c.status !== 'SKIPPED' && c.detail) return c.detail;
  }
  return result.launch.detail ?? '';
}

export function durationText(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export { formatDuration };
