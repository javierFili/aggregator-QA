import { parseAmount } from '../../../util/amount.js';
import type { GameBrowserContext } from '../GameBrowserContext.js';
import type { LimitDetectionResult, LimitDetector } from '../LimitDetector.js';

/** Strategy 1a — standard form controls tied to the bet: `<input name="bet" min="0.10" max="100" value="1">`. */
export class InputLimitDetector implements LimitDetector {
  readonly name = 'input-attributes';

  async detect(context: GameBrowserContext): Promise<LimitDetectionResult> {
    const result: LimitDetectionResult = { detector: this.name };
    for (const frame of context.snapshot.frames) {
      for (const el of frame.betElements) {
        if (el.tag !== 'input' && el.tag !== 'select') continue;
        const label = `<${el.tag}${el.id ? `#${el.id}` : ''}${el.name ? ` name=${el.name}` : ''}>`;
        const min = parseAmount(el.attributes.min);
        const max = parseAmount(el.attributes.max);
        const value = parseAmount(el.value ?? el.attributes.value);
        if (min !== undefined && !result.min) result.min = { value: min, confidence: 'high', evidence: `${label} min="${el.attributes.min}"` };
        if (max !== undefined && !result.max) result.max = { value: max, confidence: 'high', evidence: `${label} max="${el.attributes.max}"` };
        if (value !== undefined && !result.default) result.default = { value, confidence: 'high', evidence: `${label} value="${el.value ?? el.attributes.value}"` };
      }
    }
    return result;
  }
}
