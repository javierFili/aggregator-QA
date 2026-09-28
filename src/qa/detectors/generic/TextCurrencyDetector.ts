import { CURRENCY_SYMBOLS, KNOWN_CURRENCIES } from '../../../types/Currency.js';
import { allTexts, type GameBrowserContext } from '../GameBrowserContext.js';
import type { CurrencyDetectionResult, CurrencyDetector } from '../CurrencyDetector.js';

const DOLLAR_CURRENCIES = new Set(['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'ARS', 'CLP', 'COP', 'UYU', 'SGD', 'HKD', 'TWD']);
const CODE_RE = new RegExp(`(?<![A-Za-z])(${KNOWN_CURRENCIES.join('|')})(?![A-Za-z])`, 'g');

/** Currency codes and unambiguous symbols in the visible text (balance, bet display, paytable...). */
export class TextCurrencyDetector implements CurrencyDetector {
  readonly name = 'visible-text';

  async detect(context: GameBrowserContext): Promise<CurrencyDetectionResult> {
    return this.detectInTexts(allTexts(context), context.currency);
  }

  detectInTexts(texts: string[], currency: string): CurrencyDetectionResult {
    const expected = currency.toUpperCase();
    const found = new Map<string, string>();
    for (const text of texts) {
      for (const m of text.matchAll(CODE_RE)) {
        const code = m[1]!;
        if (!found.has(code)) found.set(code, excerpt(text, m.index ?? 0));
      }
      for (const [code, symbols] of Object.entries(CURRENCY_SYMBOLS)) {
        for (const symbol of symbols) {
          const idx = symbolIndex(text, symbol);
          if (idx >= 0 && !found.has(code)) found.set(code, excerpt(text, idx));
        }
      }
      if (DOLLAR_CURRENCIES.has(expected) && !found.has(expected)) {
        const idx = text.search(/(?<![A-Z]|R)\$\s?\d/);
        if (idx >= 0) found.set(expected, excerpt(text, idx));
      }
    }
    const codes = [...found.keys()];
    if (!codes.length) return { detector: this.name, status: 'NOT_DETECTED', found: [], confidence: 'low' };
    if (found.has(expected)) return { detector: this.name, status: 'DETECTED', found: codes, confidence: 'low', evidence: found.get(expected)! };
    return { detector: this.name, status: 'CONFLICT', found: codes, confidence: 'low', evidence: [...found.values()].slice(0, 3).join('; ') };
  }
}

/** Short symbols (e.g. "R ", "lei") must be next to a number to count. */
function symbolIndex(text: string, symbol: string): number {
  if (/^[£€¥₹₺₴₩₦₱]$/.test(symbol)) return text.indexOf(symbol);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z])${escaped}\\s?\\d|\\d\\s?${escaped}(?![A-Za-z])`);
  return text.search(re);
}

function excerpt(text: string, index: number): string {
  return text.slice(Math.max(0, index - 30), index + 30).replace(/\s+/g, ' ').trim();
}
