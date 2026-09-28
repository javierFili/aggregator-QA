import { describe, expect, it } from 'vitest';
import { ConfigValidationError, parseRunConfig } from '../../src/qa/QaConfig.js';
import { selectGames } from '../../src/qa/QaRunner.js';

const limits = { defaultWorkers: 5, maxWorkers: 20 };
const base = { aggregatorUrl: 'https://integration.example.test/', partnerCode: 'alpha-test', apiKey: 'k' };

describe('parseRunConfig', () => {
  it('normalises input from the UI', () => {
    const c = parseRunConfig(
      { ...base, currencies: ['gbp', 'EUR', 'eur', 'bad!'], workers: '50', lang: 'ES', expectedLimits: { min: '0,10', default: '', max: '100' }, filters: { gameIds: '4182, 4170 x', providers: ['evolution'] }, options: { testUndeclaredCurrencies: 'on' } },
      limits,
    );
    expect(c.aggregatorUrl).toBe('https://integration.example.test');
    expect(c.currencies).toEqual(['GBP', 'EUR']);
    expect(c.workers).toBe(20);
    expect(c.lang).toBe('es');
    expect(c.expectedLimits).toEqual({ min: 0.1, max: 100 });
    expect(c.filters.gameIds).toEqual([4182, 4170]);
    expect(c.options).toMatchObject({ testUndeclaredCurrencies: true, testCurrencies: true, browserCheck: true });
  });

  it('rejects invalid values', () => {
    expect(() => parseRunConfig({ ...base, apiKey: '' }, limits)).toThrow(ConfigValidationError);
    expect(() => parseRunConfig({ ...base, aggregatorUrl: 'javascript:alert(1)' }, limits)).toThrow(ConfigValidationError);
    expect(() => parseRunConfig({ ...base, expectedLimits: { min: 'abc' } }, limits)).toThrow(ConfigValidationError);
    expect(() => parseRunConfig({ ...base, expectedLimits: { min: 10, max: 1 } }, limits)).toThrow(ConfigValidationError);
    expect(() => parseRunConfig({ ...base, lang: '../x' }, limits)).toThrow(ConfigValidationError);
  });
});

describe('selectGames', () => {
  const games = [
    { id: 1, name: 'a', provider: 'Evolution', device: [], currencies: [] },
    { id: 2, name: 'b', provider: 'royal7', device: [], currencies: [] },
    { id: 3, name: 'c', provider: 'evolution', device: [], currencies: [] },
  ];
  it('filters by provider, ids and max', () => {
    expect(selectGames(games, { providers: ['evolution'], gameIds: [], maxGames: 0 }).map((g) => g.id)).toEqual([1, 3]);
    expect(selectGames(games, { providers: [], gameIds: [2], maxGames: 0 }).map((g) => g.id)).toEqual([2]);
    expect(selectGames(games, { providers: [], gameIds: [], maxGames: 2 }).map((g) => g.id)).toEqual([1, 2]);
  });
});

describe('QA players config', () => {
  it('prefix is optional and validated', () => {
    expect(parseRunConfig(base, limits).players).toEqual({});
    expect(parseRunConfig({ ...base, players: { prefix: 'qa-runner' } }, limits).players).toEqual({ prefix: 'qa-runner' });
    expect(() => parseRunConfig({ ...base, players: { prefix: 'bad prefix!' } }, limits)).toThrow(ConfigValidationError);
  });
});

describe('endpoint with partner code', () => {
  it('takes the partner from the endpoint path', () => {
    const c = parseRunConfig({ aggregatorUrl: 'https://integration.playgg.uno/alpha-test/', apiKey: 'k' }, limits);
    expect([c.aggregatorUrl, c.partnerCode]).toEqual(['https://integration.playgg.uno', 'alpha-test']);
    const explicit = parseRunConfig({ aggregatorUrl: 'https://integration.playgg.uno', partnerCode: 'beta', apiKey: 'k' }, limits);
    expect([explicit.aggregatorUrl, explicit.partnerCode]).toEqual(['https://integration.playgg.uno', 'beta']);
    expect(() => parseRunConfig({ aggregatorUrl: 'https://integration.playgg.uno', apiKey: 'k' }, limits)).toThrow(ConfigValidationError);
  });
});

describe('credentials copied as given (Endpoint + Partner Code + Secret Key)', () => {
  it('does not repeat the partner when the endpoint already ends with it', () => {
    const c = parseRunConfig({ aggregatorUrl: 'https://integration.staging-pgg.icu/sping2', partnerCode: 'sping2', apiKey: 'k' }, limits);
    expect(`${c.aggregatorUrl}/${c.partnerCode}`).toBe('https://integration.staging-pgg.icu/sping2');
  });
});
