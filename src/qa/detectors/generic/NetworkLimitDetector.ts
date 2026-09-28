import { amountsEqual, parseAmount } from '../../../util/amount.js';
import { normalizeKey, walkJson, type GameBrowserContext } from '../GameBrowserContext.js';
import type { LimitDetectionResult, LimitDetector, LimitField } from '../LimitDetector.js';

const FLAT_KEYS: Record<LimitField, string[]> = {
  min: ['minbet', 'betmin', 'minstake', 'stakemin', 'minimumbet', 'mintotalbet', 'minbetamount', 'minbetvalue', 'minimumstake', 'lowerbetlimit'],
  max: ['maxbet', 'betmax', 'maxstake', 'stakemax', 'maximumbet', 'maxtotalbet', 'maxbetamount', 'maxbetvalue', 'maximumstake', 'upperbetlimit'],
  default: ['defaultbet', 'betdefault', 'defaultstake', 'stakedefault', 'initialbet', 'defbet', 'defaultbetamount', 'defaultbetvalue', 'defaulttotalbet'],
};

const CONTAINER_KEYS = ['betlimits', 'betlimit', 'limits', 'stakelimits', 'betconfig', 'betsettings', 'bet'];
const CONTAINER_CHILD: Record<LimitField, string[]> = { min: ['min', 'minimum'], max: ['max', 'maximum'], default: ['default', 'def', 'initial'] };

/** Strategy 4 — JSON responses captured while the game initialises (`{ "minBet": 0.1, "maxBet": 100, "defaultBet": 1 }`). */
export class NetworkLimitDetector implements LimitDetector {
  readonly name = 'network-json';

  async detect(context: GameBrowserContext): Promise<LimitDetectionResult> {
    const result: LimitDetectionResult = { detector: this.name };
    const extra = new Map<LimitField, Set<number>>();

    const record = (field: LimitField, value: number, evidence: string): void => {
      if (!result[field]) result[field] = { value, confidence: 'high', evidence };
      else if (!amountsEqual(result[field].value, value)) {
        const set = extra.get(field) ?? new Set<number>();
        set.add(value);
        extra.set(field, set);
      }
    };

    for (const response of context.snapshot.responses) {
      if (response.json === undefined) continue;
      const path = safePath(response.url);
      walkJson(response.json, (key, value) => {
        const k = normalizeKey(key);
        for (const field of ['min', 'max', 'default'] as const) {
          if (FLAT_KEYS[field].includes(k)) {
            const amount = typeof value === 'number' || typeof value === 'string' ? parseAmount(value) : undefined;
            if (amount !== undefined) record(field, amount, `${path} → ${key}=${String(value)}`);
          }
        }
        if (CONTAINER_KEYS.includes(k) && value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            const ck = normalizeKey(childKey);
            for (const field of ['min', 'max', 'default'] as const) {
              if (!CONTAINER_CHILD[field].includes(ck)) continue;
              const amount = typeof childValue === 'number' || typeof childValue === 'string' ? parseAmount(childValue) : undefined;
              if (amount !== undefined) record(field, amount, `${path} → ${key}.${childKey}=${String(childValue)}`);
            }
          }
        }
      });
    }
    const notes: string[] = [];
    for (const [field, values] of extra) notes.push(`${field}: también se encontraron ${[...values].join(', ')}`);
    if (notes.length) result.notes = notes;
    return result;
  }
}

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}
