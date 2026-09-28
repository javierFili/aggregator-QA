# Provider-specific detectors

Put detectors that only make sense for one provider here, one folder per provider code
(the `provider` field returned by opType 1071), e.g.:

```text
providers/
  evolution/EvolutionLimitDetector.ts
  pragmatic/PragmaticCurrencyDetector.ts
```

Each class implements `LimitDetector` or `CurrencyDetector` and is registered in
`createDefaultDetectorRegistry()` (`../DetectorRegistry.ts`):

```ts
registry.registerLimitDetector('evolution', new EvolutionLimitDetector());
```

Provider detectors run before the generic ones, so their values take priority.
Only add one when evidence from real games (screenshots/diagnostics in `reports/`) shows the
generic detectors cannot read that provider.
