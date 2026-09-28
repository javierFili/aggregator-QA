import type { CurrencyDetector } from './CurrencyDetector.js';
import { AccessibilityLimitDetector } from './generic/AccessibilityLimitDetector.js';
import { DomLimitDetector } from './generic/DomLimitDetector.js';
import { InputLimitDetector } from './generic/InputLimitDetector.js';
import { NetworkCurrencyDetector } from './generic/NetworkCurrencyDetector.js';
import { NetworkLimitDetector } from './generic/NetworkLimitDetector.js';
import { TextCurrencyDetector } from './generic/TextCurrencyDetector.js';
import { TextLimitDetector } from './generic/TextLimitDetector.js';
import type { LimitDetector } from './LimitDetector.js';

/**
 * Resolves the detectors used for a game. Provider-specific detectors (see detectors/providers/README.md)
 * run BEFORE the generic ones, so their values take priority when both find something.
 */
export class DetectorRegistry {
  private readonly providerLimit = new Map<string, LimitDetector[]>();
  private readonly providerCurrency = new Map<string, CurrencyDetector[]>();

  constructor(
    /** Generic detectors, in priority order. */
    private readonly genericLimit: LimitDetector[] = [
      new NetworkLimitDetector(),
      new InputLimitDetector(),
      new DomLimitDetector(),
      new AccessibilityLimitDetector(),
      new TextLimitDetector(),
    ],
    private readonly genericCurrency: CurrencyDetector[] = [new NetworkCurrencyDetector(), new TextCurrencyDetector()],
  ) {}

  registerLimitDetector(providerCode: string, detector: LimitDetector): this {
    const key = providerCode.toLowerCase();
    this.providerLimit.set(key, [...(this.providerLimit.get(key) ?? []), detector]);
    return this;
  }

  registerCurrencyDetector(providerCode: string, detector: CurrencyDetector): this {
    const key = providerCode.toLowerCase();
    this.providerCurrency.set(key, [...(this.providerCurrency.get(key) ?? []), detector]);
    return this;
  }

  limitDetectorsFor(providerCode: string): LimitDetector[] {
    return [...(this.providerLimit.get(providerCode.toLowerCase()) ?? []), ...this.genericLimit];
  }

  currencyDetectorsFor(providerCode: string): CurrencyDetector[] {
    return [...(this.providerCurrency.get(providerCode.toLowerCase()) ?? []), ...this.genericCurrency];
  }
}

/** Default registry. Register provider-specific detectors here once real games prove they are needed. */
export function createDefaultDetectorRegistry(): DetectorRegistry {
  const registry = new DetectorRegistry();
  // Example: registry.registerLimitDetector('evolution', new EvolutionLimitDetector());
  return registry;
}
