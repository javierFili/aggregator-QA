import { normalizeKey, walkJson, type GameBrowserContext } from '../GameBrowserContext.js';
import type { CurrencyDetectionResult, CurrencyDetector } from '../CurrencyDetector.js';

const CURRENCY_KEYS = ['currency', 'currencycode', 'currencyiso', 'ccy', 'curr', 'playercurrency', 'walletcurrency', 'balancecurrency'];

/** Explicit `currency` fields in JSON responses captured during game initialisation (session/balance/config). */
export class NetworkCurrencyDetector implements CurrencyDetector {
  readonly name = 'network-json';

  async detect(context: GameBrowserContext): Promise<CurrencyDetectionResult> {
    const found = new Map<string, string>();
    for (const response of context.snapshot.responses) {
      if (response.json === undefined) continue;
      walkJson(response.json, (key, value) => {
        if (!CURRENCY_KEYS.includes(normalizeKey(key))) return;
        const code =
          typeof value === 'string'
            ? value.trim().toUpperCase()
            : value && typeof value === 'object' && typeof (value as { code?: unknown }).code === 'string'
              ? String((value as { code: string }).code).toUpperCase()
              : '';
        if (/^[A-Z]{3}$/.test(code) && !found.has(code)) found.set(code, `${shortUrl(response.url)} → ${key}=${code}`);
      });
    }
    const codes = [...found.keys()];
    if (!codes.length) return { detector: this.name, status: 'NOT_DETECTED', found: [], confidence: 'high' };
    const expected = context.currency.toUpperCase();
    if (found.has(expected)) return { detector: this.name, status: 'DETECTED', found: codes, confidence: 'high', evidence: found.get(expected)! };
    return { detector: this.name, status: 'CONFLICT', found: codes, confidence: 'high', evidence: [...found.values()].slice(0, 3).join('; ') };
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.slice(0, 100);
  } catch {
    return url.slice(0, 100);
  }
}
