import { describe, expect, it } from 'vitest';
import type { GameBrowserContext } from '../../src/qa/detectors/GameBrowserContext.js';
import { AccessibilityLimitDetector } from '../../src/qa/detectors/generic/AccessibilityLimitDetector.js';
import { DomLimitDetector } from '../../src/qa/detectors/generic/DomLimitDetector.js';
import { InputLimitDetector } from '../../src/qa/detectors/generic/InputLimitDetector.js';
import { NetworkLimitDetector } from '../../src/qa/detectors/generic/NetworkLimitDetector.js';
import { TextLimitDetector } from '../../src/qa/detectors/generic/TextLimitDetector.js';
import { createDefaultDetectorRegistry, DetectorRegistry } from '../../src/qa/detectors/DetectorRegistry.js';
import { combineLimitDetections, type LimitDetector } from '../../src/qa/detectors/LimitDetector.js';
import { compareLimit, evaluateLimits, LimitsTest } from '../../src/qa/tests/LimitsTest.js';
import { parseAmount } from '../../src/util/amount.js';
import { frame, snapshot } from '../helpers/snapshot.js';

const game = { id: 1, name: 'G', provider: 'evolution', device: [], currencies: ['EUR'] };
const ctx = (s: ReturnType<typeof snapshot>): GameBrowserContext => ({ game, currency: 'EUR', lang: 'en', snapshot: s });

describe('parseAmount', () => {
  it.each([
    ['0.10', 0.1], ['0,10', 0.1], ['1,000.50', 1000.5], ['1.000,50', 1000.5], ['€ 2', 2], ['100', 100], ['1,000', 1000], ['1.000.000', 1000000], ['abc', undefined],
  ])('%s → %s', (raw, value) => expect(parseAmount(raw)).toBe(value));
});

describe('limit comparison', () => {
  const detected = (value: number, confidence: 'high' | 'low' = 'high') => ({ value, confidence, evidence: 'e', detector: 'd' });

  it('PASS / FAIL / NOT_DETECTED / SKIPPED', () => {
    expect(compareLimit('min', 0.1, detected(0.1)).check.status).toBe('PASS');
    const fail = compareLimit('min', 0.1, detected(0.2));
    expect(fail.check.status).toBe('FAIL');
    expect(fail.error?.type).toBe('LIMIT_MISMATCH');
    expect(compareLimit('min', 0.1, undefined).check.status).toBe('NOT_DETECTED');
    expect(compareLimit('min', undefined, detected(0.1)).check.status).toBe('SKIPPED');
  });

  it('weak heuristics and unit mismatches become REVIEW, not FAIL', () => {
    expect(compareLimit('default', 1, detected(2, 'low')).check.status).toBe('REVIEW');
    expect(compareLimit('min', 0.1, detected(10)).check.status).toBe('REVIEW');
  });

  it('evaluates all three fields', () => {
    const detection = combineLimitDetections([{ detector: 'x', min: { value: 0.1, confidence: 'high', evidence: '' }, max: { value: 50, confidence: 'high', evidence: '' } }]);
    const r = evaluateLimits(detection, { min: 0.1, default: 1, max: 100 });
    expect([r.min.status, r.default.status, r.max.status]).toEqual(['PASS', 'NOT_DETECTED', 'FAIL']);
    expect(r.errors).toHaveLength(1);
  });
});

describe('limit detectors', () => {
  it('input attributes', async () => {
    const s = snapshot({ frames: [frame('', { betElements: [{ tag: 'input', name: 'bet', value: '1', attributes: { min: '0.10', max: '100', value: '1' } }] })] });
    const r = await new InputLimitDetector().detect(ctx(s));
    expect([r.min?.value, r.default?.value, r.max?.value]).toEqual([0.1, 1, 100]);
  });

  it('data attributes', async () => {
    const s = snapshot({ frames: [frame('', { betElements: [{ tag: 'div', className: 'bet-panel', attributes: { 'data-min': '0.2', 'data-max': '200', 'data-default': '2' } }] })] });
    const r = await new DomLimitDetector().detect(ctx(s));
    expect([r.min?.value, r.default?.value, r.max?.value]).toEqual([0.2, 2, 200]);
  });

  it('aria values', async () => {
    const s = snapshot({ frames: [frame('', { ariaElements: [{ tag: 'div', role: 'slider', attributes: { 'aria-label': 'Bet amount', 'aria-valuemin': '0.1', 'aria-valuemax': '10', 'aria-valuenow': '0.5' } }, { tag: 'div', attributes: { 'aria-label': 'Volume', 'aria-valuemin': '0', 'aria-valuemax': '100' } }] })] });
    const r = await new AccessibilityLimitDetector().detect(ctx(s));
    expect([r.min?.value, r.default?.value, r.max?.value]).toEqual([0.1, 0.5, 10]);
  });

  it('visible text in several languages', () => {
    const t = new TextLimitDetector();
    const en = t.detectInTexts(['MIN BET: €0.10\nMAX BET\n€100.00\nBET 1.00']);
    expect([en.min?.value, en.max?.value, en.default?.value, en.default?.confidence]).toEqual([0.1, 100, 1, 'low']);
    const es = t.detectInTexts(['Apuesta mínima 0,20 €  Apuesta máxima 500,00 €  Apuesta por defecto 2,00']);
    expect([es.min?.value, es.max?.value, es.default?.value, es.default?.confidence]).toEqual([0.2, 500, 2, 'high']);
    const range = t.detectInTexts(['Bet limits: 0.10 - 250']);
    expect([range.min?.value, range.max?.value]).toEqual([0.1, 250]);
    expect(t.detectInTexts(['SPIN TO WIN']).min).toBeUndefined();
  });

  it('network JSON (flat keys and containers)', async () => {
    const s = snapshot({
      responses: [
        { url: 'https://g.test/config', status: 200, contentType: 'application/json', isNavigation: false, json: { game: { minBet: 0.1, maxBet: '100', defaultBet: 1 } } },
        { url: 'https://g.test/other', status: 200, contentType: 'application/json', isNavigation: false, json: { betLimits: { min: 0.5, max: 100 } } },
      ],
    });
    const r = await new NetworkLimitDetector().detect(ctx(s));
    expect([r.min?.value, r.default?.value, r.max?.value]).toEqual([0.1, 1, 100]);
    expect(r.notes?.[0]).toContain('0.5');
  });

  it('LimitsTest runs registry detectors in priority order (provider-specific first)', async () => {
    const custom: LimitDetector = { name: 'evo', detect: async () => ({ detector: 'evo', min: { value: 0.1, confidence: 'high', evidence: 'evo' } }) };
    const registry = new DetectorRegistry().registerLimitDetector('Evolution', custom);
    const detectors = registry.limitDetectorsFor('evolution');
    expect(detectors[0]!.name).toBe('evo');
    expect(createDefaultDetectorRegistry().limitDetectorsFor('evolution')[0]!.name).toBe('network-json');
    const s = snapshot({ frames: [frame('MIN BET 0.50')] });
    const r = await new LimitsTest().run(ctx(s), detectors, { min: 0.1 });
    expect(r.min).toMatchObject({ status: 'PASS', source: 'evo' });
  });
});
