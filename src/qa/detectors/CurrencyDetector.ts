import type { GameBrowserContext } from './GameBrowserContext.js';

export type CurrencyDetectionStatus = 'DETECTED' | 'NOT_DETECTED' | 'CONFLICT' | 'NOT_APPLICABLE';

export interface CurrencyDetectionResult {
  detector: string;
  status: CurrencyDetectionStatus;
  /** Currencies seen in the game (ISO codes). */
  found: string[];
  /** high = explicit structured currency field; low = text / symbol heuristics. */
  confidence: 'high' | 'low';
  evidence?: string;
}

export interface CurrencyDetector {
  readonly name: string;
  detect(context: GameBrowserContext): Promise<CurrencyDetectionResult>;
}

export interface CombinedCurrencyDetection {
  status: CurrencyDetectionStatus;
  confidence: 'high' | 'low';
  detector?: string;
  found: string[];
  evidence?: string;
  all: CurrencyDetectionResult[];
}

/** DETECTED anywhere wins; otherwise a high-confidence conflict beats a low-confidence one; otherwise NOT_DETECTED. */
export function combineCurrencyDetections(results: CurrencyDetectionResult[]): CombinedCurrencyDetection {
  const found = [...new Set(results.flatMap((r) => r.found))];
  const pick =
    results.find((r) => r.status === 'DETECTED' && r.confidence === 'high') ??
    results.find((r) => r.status === 'DETECTED') ??
    results.find((r) => r.status === 'CONFLICT' && r.confidence === 'high') ??
    results.find((r) => r.status === 'CONFLICT');
  if (!pick) {
    const applicable = results.some((r) => r.status !== 'NOT_APPLICABLE');
    return { status: applicable ? 'NOT_DETECTED' : 'NOT_APPLICABLE', confidence: 'low', found, all: results };
  }
  const combined: CombinedCurrencyDetection = { status: pick.status, confidence: pick.confidence, detector: pick.detector, found, all: results };
  if (pick.evidence) combined.evidence = pick.evidence;
  return combined;
}
