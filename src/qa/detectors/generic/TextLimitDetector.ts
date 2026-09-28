import { KNOWN_CURRENCIES } from '../../../types/Currency.js';
import { parseAmount } from '../../../util/amount.js';
import { allTexts, type GameBrowserContext } from '../GameBrowserContext.js';
import type { LimitCandidate, LimitDetectionResult, LimitDetector, LimitField } from '../LimitDetector.js';

const CODES = KNOWN_CURRENCIES.join('|');
/** Optional currency code/symbol before or after the number (codes limited to real ISO codes: the regex is case-insensitive). */
const AMOUNT = String.raw`(?:(?:${CODES})(?![\p{L}])|R\$|[£€$₹₺¥])?\s?(\d[\d.,]*\d|\d)(?:[ \t]?(?:(?:${CODES}|lei)(?![\p{L}])|[£€$]))?`;
const SEP = String.raw`[\s:=\-–]{0,8}`;

/** Label vocabularies (EN, ES, PT, RO, DE, FR, IT). */
const LABELS: Record<LimitField, string[]> = {
  min: [
    'minimum\\s*bet', 'min\\.?\\s*bet', 'min\\.?\\s*stake', 'minimum\\s*stake', 'bet\\s*min(?:imum)?', 'apuesta\\s*m[ií]n(?:ima)?', 'aposta\\s*m[ií]n(?:ima)?',
    'miz[ăa]\\s*minim[ăa]', 'mindesteinsatz', 'mise\\s*min(?:imale|imum)?', 'puntata\\s*min(?:ima)?', 'minimum', 'm[ií]nimo', 'm[ií]nima', 'min',
  ],
  max: [
    'maximum\\s*bet', 'max\\.?\\s*bet', 'max\\.?\\s*stake', 'maximum\\s*stake', 'bet\\s*max(?:imum)?', 'apuesta\\s*m[aá]x(?:ima)?', 'aposta\\s*m[aá]x(?:ima)?',
    'miz[ăa]\\s*maxim[ăa]', 'h[öo]chsteinsatz', 'maximaleinsatz', 'mise\\s*max(?:imale|imum)?', 'puntata\\s*max(?:ima)?', 'maximum', 'm[aá]ximo', 'm[aá]xima', 'max',
  ],
  default: ['default\\s*bet', 'default\\s*stake', 'apuesta\\s*(?:por\\s*defecto|predeterminada|inicial)', 'aposta\\s*(?:padr[ãa]o|inicial)', 'miz[ăa]\\s*implicit[ăa]', 'default'],
};

/** Labels showing the current bet. At initial state it equals the default bet, but it is only a heuristic. */
const CURRENT_BET_LABELS = ['total\\s*bet', 'total\\s*stake', 'apuesta\\s*total', 'aposta\\s*total', 'miz[ăa]\\s*total[ăa]', 'bet', 'stake', 'apuesta', 'aposta', 'miz[ăa]', 'einsatz', 'mise', 'puntata'];

const RANGE_LABELS = ['bet\\s*limits?', 'stake\\s*limits?', 'table\\s*limits?', 'limits?', 'l[ií]mites?(?:\\s*de\\s*apuesta)?', 'limite(?:s)?'];

function labelRegex(labels: string[], flags = 'giu'): RegExp {
  return new RegExp(String.raw`(?<![\p{L}])(${labels.join('|')})(?![\p{L}])${SEP}${AMOUNT}`, flags);
}

/** Strategy 2 — visible text such as "MIN BET 0.10", "Apuesta máxima: 100,00 €" or "Limits 0.10 - 100". */
export class TextLimitDetector implements LimitDetector {
  readonly name = 'visible-text';

  async detect(context: GameBrowserContext): Promise<LimitDetectionResult> {
    return this.detectInTexts(allTexts(context));
  }

  detectInTexts(texts: string[]): LimitDetectionResult {
    const result: LimitDetectionResult = { detector: this.name };
    for (const raw of texts) {
      let text = raw;
      const range = new RegExp(String.raw`(?<![\p{L}])(${RANGE_LABELS.join('|')})(?![\p{L}])${SEP}${AMOUNT}\s*(?:-|–|—|/|to|a|até)\s*${AMOUNT}`, 'iu').exec(text);
      if (range) {
        const lo = parseAmount(range[2]);
        const hi = parseAmount(range[3]);
        if (lo !== undefined && !result.min) result.min = candidate(lo, 'high', range[0]);
        if (hi !== undefined && !result.max) result.max = candidate(hi, 'high', range[0]);
        text = text.replace(range[0], ' ');
      }
      for (const field of ['min', 'max', 'default'] as const) {
        const re = labelRegex(LABELS[field]);
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const value = parseAmount(m[2]);
          if (value !== undefined && !result[field]) result[field] = candidate(value, 'high', m[0]);
          text = text.replace(m[0], ' '.repeat(m[0].length)); // do not re-use "MIN BET" as a "BET" label below
        }
      }
      if (!result.default) {
        const re = labelRegex(CURRENT_BET_LABELS, 'iu');
        const m = re.exec(text);
        const value = m ? parseAmount(m[2]) : undefined;
        if (m && value !== undefined) result.default = candidate(value, 'low', m[0]);
      }
    }
    return result;
  }
}

function candidate(value: number, confidence: LimitCandidate['confidence'], evidence: string): LimitCandidate {
  return { value, confidence, evidence: evidence.replace(/\s+/g, ' ').trim().slice(0, 120) };
}
