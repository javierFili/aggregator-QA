import { describe, expect, it } from 'vitest';
import { parseExistingPlayers } from '../../src/aggregator/TokenService.js';
import { parseRunConfig } from '../../src/qa/QaConfig.js';
import { probeSessions } from '../../src/qa/SessionProbe.js';
import { envelope, fakeFetch } from '../helpers/fakeFetch.js';

const cfg = (extra: Record<string, unknown> = {}) =>
  parseRunConfig({ aggregatorUrl: 'https://agg.test/p', apiKey: 'k', currencies: ['EUR', 'GBP'], players: { prefix: 'qa-runner' }, ...extra }, { defaultWorkers: 5, maxWorkers: 20 });

describe('probeSessions', () => {
  it('reports each currency, with the automatic player name and the aggregator answer', async () => {
    const r = await probeSessions(cfg(), 1000, fakeFetch({ 'https://agg.test/p': envelope('ERR-0001: Invalid Api-Key.', false) }));
    expect(r.results.map((x) => [x.currency, x.username, x.ok, x.response])).toEqual([
      ['EUR', 'qa-runner-eur-w01', false, 'ERR-0001: Invalid Api-Key.'],
      ['GBP', 'qa-runner-gbp-w01', false, 'ERR-0001: Invalid Api-Key.'],
    ]);
  });

  it('reports success without exposing the token', async () => {
    const r = await probeSessions(cfg(), 1000, fakeFetch({ 'https://agg.test/p': envelope('1e5e5ad8-a2b09164-b240b1f1') }));
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('b240b1f1');
  });
});

describe('existing players', () => {
  it('parses DIVISA;username;user_id;md5 lines', () => {
    expect(parseExistingPlayers('eur;player1;784401454;6698885435b67ca9d5f05c5ebe52a0d9\n# comment\nUSD,player2,,abc')).toEqual({
      EUR: { username: 'player1', userId: '784401454', md5: '6698885435b67ca9d5f05c5ebe52a0d9' },
      USD: { username: 'player2', userId: 'player2', md5: 'abc' },
    });
    expect(() => parseExistingPlayers('EURO;x;y;z')).toThrow('línea 1');
  });
});
