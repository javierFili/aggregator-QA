import { parseAmount } from '../../../util/amount.js';
import type { GameBrowserContext } from '../GameBrowserContext.js';
import type { LimitDetectionResult, LimitDetector, LimitField } from '../LimitDetector.js';

const ATTRIBUTE_MAP: Array<[string, LimitField]> = [
  ['data-min-bet', 'min'],
  ['data-min', 'min'],
  ['data-max-bet', 'max'],
  ['data-max', 'max'],
  ['data-default-bet', 'default'],
  ['data-default', 'default'],
  ['data-bet', 'default'],
];

/** Strategy 1b — custom data attributes on bet-related elements (`data-min`, `data-max`, `data-default`, ...). */
export class DomLimitDetector implements LimitDetector {
  readonly name = 'dom-attributes';

  async detect(context: GameBrowserContext): Promise<LimitDetectionResult> {
    const result: LimitDetectionResult = { detector: this.name };
    for (const frame of context.snapshot.frames) {
      for (const el of frame.betElements) {
        for (const [attr, field] of ATTRIBUTE_MAP) {
          const raw = el.attributes[attr];
          const value = parseAmount(raw);
          if (value === undefined || result[field]) continue;
          result[field] = { value, confidence: 'high', evidence: `<${el.tag}${el.id ? `#${el.id}` : ''}> ${attr}="${raw}"` };
        }
      }
    }
    return result;
  }
}
