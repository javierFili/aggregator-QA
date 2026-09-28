import type { GameBrowserContext } from './GameBrowserContext.js';

export type LimitField = 'min' | 'default' | 'max';

export interface LimitCandidate {
  value: number;
  /** high = explicit structured value; low = heuristic (e.g. a "BET 1.00" label). */
  confidence: 'high' | 'low';
  evidence: string;
}

export interface LimitDetectionResult {
  detector: string;
  min?: LimitCandidate;
  default?: LimitCandidate;
  max?: LimitCandidate;
  notes?: string[];
}

export interface LimitDetector {
  readonly name: string;
  detect(context: GameBrowserContext): Promise<LimitDetectionResult>;
}

export interface CombinedLimit extends LimitCandidate {
  detector: string;
}

export type CombinedLimits = Partial<Record<LimitField, CombinedLimit>> & { all: LimitDetectionResult[] };

/** Picks, for each field, the value from the highest-priority detector that found one (detectors are given in priority order). */
export function combineLimitDetections(results: LimitDetectionResult[]): CombinedLimits {
  const combined: CombinedLimits = { all: results };
  for (const field of ['min', 'default', 'max'] as const) {
    const highFirst = [...results.filter((r) => r[field]?.confidence === 'high'), ...results.filter((r) => r[field]?.confidence === 'low')];
    const winner = highFirst[0];
    const candidate = winner?.[field];
    if (winner && candidate) combined[field] = { ...candidate, detector: winner.detector };
  }
  return combined;
}
