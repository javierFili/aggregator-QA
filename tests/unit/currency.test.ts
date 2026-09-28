import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../src/browser/GameSnapshot.js';
import { frame, snapshot } from '../helpers/snapshot.js';
import { combineCurrencyDetections } from '../../src/qa/detectors/CurrencyDetector.js';
import type { GameBrowserContext } from '../../src/qa/detectors/GameBrowserContext.js';
import { NetworkCurrencyDetector } from '../../src/qa/detectors/generic/NetworkCurrencyDetector.js';
import { TextCurrencyDetector } from '../../src/qa/detectors/generic/TextCurrencyDetector.js';
import { compareCurrencies, CurrencyTest, planCurrencies } from '../../src/qa/tests/CurrencyTest.js';
import { normalizeCurrencies } from '../../src/types/Currency.js';
import type { Game } from '../../src/types/Game.js';

const game: Game = { id: 1, name: 'G', provider: 'p', device: ['desktop'], currencies: ['EUR', 'GBP', 'USD'] };

const ctx = (currency: string, s: GameSnapshot): GameBrowserContext => ({ game, currency, lang: 'en', snapshot: s });

describe('currency selection', () => {
  it('normalises codes: upper case, 3 letters, no duplicates', () => {
    expect(normalizeCurrencies(['gbp', 'EUR', ' usd ', 'EUR', 'EURO', 12, 'br'])).toEqual(['GBP', 'EUR', 'USD']);
  });

  it('compares selected currencies with the 1071 declaration', () => {
    expect(compareCurrencies(game, ['EUR', 'GBP', 'USD', 'BRL'])).toEqual({ EUR: 'DECLARED', GBP: 'DECLARED', USD: 'DECLARED', BRL: 'NOT_DECLARED' });
    expect(compareCurrencies({ ...game, currencies: [] }, ['EUR'])).toEqual({ EUR: 'UNKNOWN' });
  });

  it('plans currencies to test', () => {
    expect(planCurrencies(game, ['BRL', 'EUR'], true)).toEqual(['BRL', 'EUR']);
    expect(planCurrencies(game, ['BRL', 'GBP'], false)).toEqual(['GBP']);
    expect(planCurrencies(game, ['BRL'], false)).toEqual(['EUR']);
    expect(planCurrencies(game, [], true)).toEqual(['EUR']);
    expect(planCurrencies({ ...game, currencies: [] }, [], true)).toEqual([]);
  });
});

describe('currency detectors', () => {
  it('network: explicit currency field', async () => {
    const s = snapshot({ responses: [{ url: 'https://g.test/api/init', status: 200, contentType: 'application/json', isNavigation: false, json: { player: { currency: 'gbp' } } }] });
    expect((await new NetworkCurrencyDetector().detect(ctx('GBP', s))).status).toBe('DETECTED');
    const conflict = await new NetworkCurrencyDetector().detect(ctx('EUR', s));
    expect(conflict).toMatchObject({ status: 'CONFLICT', confidence: 'high', found: ['GBP'] });
  });

  it('text: codes and symbols', () => {
    const t = new TextCurrencyDetector();
    expect(t.detectInTexts(['Balance £10.00'], 'GBP').status).toBe('DETECTED');
    expect(t.detectInTexts(['BALANCE 10.00 EUR'], 'EUR').status).toBe('DETECTED');
    expect(t.detectInTexts(['Balance $0.00'], 'USD').status).toBe('DETECTED');
    expect(t.detectInTexts(['Saldo R$ 5,00'], 'BRL').status).toBe('DETECTED');
    expect(t.detectInTexts(['Balance €10.00'], 'GBP')).toMatchObject({ status: 'CONFLICT', confidence: 'low' });
    expect(t.detectInTexts(['SPIN AUTOPLAY'], 'GBP').status).toBe('NOT_DETECTED');
  });

  it('maps detection to check statuses (NOT_DETECTED is not a failure)', async () => {
    const test = new CurrencyTest();
    const detectors = [new NetworkCurrencyDetector(), new TextCurrencyDetector()];
    const pass = await test.run(ctx('GBP', snapshot({ frames: [frame('Balance £0.00')] })), detectors, 'DECLARED');
    expect(pass.check.status).toBe('PASS');
    const none = await test.run(ctx('GBP', snapshot({ frames: [frame('SPIN')] })), detectors, 'DECLARED');
    expect(none.check.status).toBe('NOT_DETECTED');
    const weak = await test.run(ctx('GBP', snapshot({ frames: [frame('Balance €0.00')] })), detectors, 'DECLARED');
    expect(weak.check.status).toBe('REVIEW');
    const strong = await test.run(
      ctx('BRL', snapshot({ responses: [{ url: 'https://g.test/x', status: 200, contentType: 'application/json', isNavigation: false, json: { currency: 'EUR' } }] })),
      detectors,
      'NOT_DECLARED',
    );
    expect(strong.check.status).toBe('FAIL');
    expect(strong.check.detail).toContain('No declarada en 1071');
  });

  it('combines detections preferring DETECTED', () => {
    const combined = combineCurrencyDetections([
      { detector: 'a', status: 'CONFLICT', found: ['EUR'], confidence: 'low' },
      { detector: 'b', status: 'DETECTED', found: ['GBP'], confidence: 'high' },
    ]);
    expect(combined).toMatchObject({ status: 'DETECTED', detector: 'b', found: ['EUR', 'GBP'] });
  });
});
