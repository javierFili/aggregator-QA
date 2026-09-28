import { parseAmount } from '../../../util/amount.js';
import type { GameBrowserContext } from '../GameBrowserContext.js';
import type { LimitDetectionResult, LimitDetector } from '../LimitDetector.js';

const BET_LABEL = /(bet|stake|wager|apuesta|aposta|miz[ăa]|einsatz|mise|puntata)/i;

/** Strategy 3 — ARIA sliders/spinbuttons for the bet: `aria-valuemin`, `aria-valuemax`, `aria-valuenow`. */
export class AccessibilityLimitDetector implements LimitDetector {
  readonly name = 'accessibility';

  async detect(context: GameBrowserContext): Promise<LimitDetectionResult> {
    const result: LimitDetectionResult = { detector: this.name };
    for (const frame of context.snapshot.frames) {
      for (const el of frame.ariaElements) {
        const label = el.attributes['aria-label'] ?? el.id ?? el.name ?? '';
        if (!BET_LABEL.test(`${label} ${el.className ?? ''}`)) continue;
        const who = `[aria-label="${label}"]`;
        const min = parseAmount(el.attributes['aria-valuemin']);
        const max = parseAmount(el.attributes['aria-valuemax']);
        const now = parseAmount(el.attributes['aria-valuetext'] ?? el.attributes['aria-valuenow']);
        if (min !== undefined && !result.min) result.min = { value: min, confidence: 'high', evidence: `${who} aria-valuemin=${min}` };
        if (max !== undefined && !result.max) result.max = { value: max, confidence: 'high', evidence: `${who} aria-valuemax=${max}` };
        if (now !== undefined && !result.default) result.default = { value: now, confidence: 'high', evidence: `${who} aria-valuenow=${now}` };
      }
    }
    return result;
  }
}
