import { describe, expect, it } from 'vitest';
import { AggregatorClient, AggregatorError } from '../../src/aggregator/AggregatorClient.js';
import { GameService, parseGames } from '../../src/aggregator/GameService.js';
import { ProviderService, parseProviders } from '../../src/aggregator/ProviderService.js';
import { derivePassword, md5 } from '../../src/aggregator/Md5Provider.js';
import { PlayerProvisioner } from '../../src/aggregator/PlayerProvisioner.js';
import { parseTokenResponse, TokenService } from '../../src/aggregator/TokenService.js';
import { Redactor } from '../../src/util/Redactor.js';
import { envelope, fakeFetch } from '../helpers/fakeFetch.js';

const BASE = 'https://integration.example.test';
const ENDPOINT = `${BASE}/alpha-test`;

function client(fetchImpl: ReturnType<typeof fakeFetch>, extra: Partial<ConstructorParameters<typeof AggregatorClient>[0]> = {}) {
  return new AggregatorClient({ baseUrl: `${BASE}/`, partnerCode: 'alpha-test', apiKey: 'secret-key-1', timeoutMs: 1000, fetchImpl, redactor: new Redactor(), ...extra });
}

describe('AggregatorClient request construction', () => {
  it('POSTs JSON to {baseUrl}/{partner} with the Api-Key header', async () => {
    const f = fakeFetch({ [ENDPOINT]: envelope([]) });
    await client(f).call({ opType: 1070 });
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(headers['Api-Key']).toBe('secret-key-1');
    expect(JSON.parse(String(init?.body))).toEqual({ opType: 1070 });
  });

  it('throws AggregatorError with the API message when status=false', async () => {
    const f = fakeFetch({ [ENDPOINT]: envelope('ERR-0000: Generic error.', false) });
    await expect(client(f).call({ opType: 1071 })).rejects.toMatchObject({ kind: 'API_ERROR', message: expect.stringContaining('ERR-0000') });
  });

  it('rejects non-JSON and envelope-less responses', async () => {
    await expect(client(fakeFetch({ [ENDPOINT]: { body: '<html>oops</html>' } })).call({ opType: 1070 })).rejects.toBeInstanceOf(AggregatorError);
    await expect(client(fakeFetch({ [ENDPOINT]: { body: { foo: 1 } } })).call({ opType: 1070 })).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
  });

  it('reports network errors', async () => {
    await expect(client(fakeFetch({})).call({ opType: 1070 })).rejects.toMatchObject({ kind: 'NETWORK_ERROR' });
  });

  it('validates the base URL and partner code', () => {
    const f = fakeFetch({});
    expect(() => client(f, { baseUrl: 'ftp://x' })).toThrow();
    expect(() => client(f, { baseUrl: 'https://user:pw@x.test' })).toThrow();
    expect(() => client(f, { partnerCode: '../admin' })).toThrow();
    expect(() => client(f, { apiKey: ' ' })).toThrow();
  });

  it('registers the API key with the redactor', () => {
    const redactor = new Redactor();
    client(fakeFetch({}), { redactor });
    expect(redactor.text('key is secret-key-1')).toBe('key is ***');
  });
});

describe('launch URL construction', () => {
  it('builds {launcher}/{partner}/launch/{gameId}/{token}?lang=xx', () => {
    const url = client(fakeFetch({})).buildLaunchUrl(4182, 'tok123', { lang: 'en' });
    expect(url).toBe(`${BASE}/alpha-test/launch/4182/tok123?lang=en`);
  });

  it('uses a separate launcher URL when configured and encodes the token', () => {
    const c = client(fakeFetch({}), { launcherUrl: 'https://launcher.example.test/' });
    expect(c.buildLaunchUrl(1, 'a/b c')).toBe('https://launcher.example.test/alpha-test/launch/1/a%2Fb%20c');
  });

  it('rejects invalid game ids and empty tokens', () => {
    const c = client(fakeFetch({}));
    expect(() => c.buildLaunchUrl(-1, 't')).toThrow();
    expect(() => c.buildLaunchUrl(1.5, 't')).toThrow();
    expect(() => c.buildLaunchUrl(1, '')).toThrow();
  });
});

describe('1070 providers', () => {
  it('parses providers', async () => {
    const f = fakeFetch({ [ENDPOINT]: envelope([{ id: 1, code: 'apollo', image: 'x.png', name: 'ApolloGames' }, { id: 2 }, null]) });
    expect(await new ProviderService(client(f)).getProviders()).toEqual([{ id: 1, code: 'apollo', image: 'x.png', name: 'ApolloGames' }]);
  });

  it('rejects unexpected payloads', () => {
    expect(() => parseProviders('nope')).toThrow();
    expect(parseProviders({ providers: [{ id: 3, code: 'x' }] })).toEqual([{ id: 3, code: 'x', name: 'x' }]);
  });
});

describe('1071 games', () => {
  it('sends the optional currency parameter', async () => {
    const f = fakeFetch({ [ENDPOINT]: envelope([]) });
    await new GameService(client(f)).getGames('EUR');
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({ opType: 1071, currency: 'EUR' });
  });

  it('parses and normalises games', async () => {
    const f = fakeFetch({
      [ENDPOINT]: envelope([
        { id: 4182, name: 'Crazy Time', media: 'm', provider: 'evolution', device: ['desktop', 'Mobile'], currencies: ['eur', 'USD', 'GBP', 'EUR', 'x'] },
        { id: '4170', name: 'Roulette', provider: 'royal7', currencies: 'EUR,USD' },
        { id: 4182, name: 'dupe' },
        { name: 'no id' },
      ]),
    });
    const games = await new GameService(client(f)).getGames();
    expect(games).toEqual([
      { id: 4182, name: 'Crazy Time', media: 'm', provider: 'evolution', device: ['desktop', 'mobile'], currencies: ['EUR', 'USD', 'GBP'] },
      { id: 4170, name: 'Roulette', provider: 'royal7', device: [], currencies: ['EUR', 'USD'] },
    ]);
  });

  it('rejects unexpected payloads', () => {
    expect(() => parseGames({})).toThrow();
  });
});

describe('1050 / 1053 player sessions', () => {
  const player = { username: 'qa-runner-eur-w01', userId: 'qa-runner-eur-w01', md5: md5('pw') };

  it('1050 request follows the docs: username, user_id, md5, currency, lang and no client token', () => {
    const body = new TokenService(client(fakeFetch({}))).buildLoginRequest(player, 'EUR', 'en');
    expect(body).toEqual({ opType: 1050, username: player.username, user_id: player.userId, md5: player.md5, currency: 'EUR', lang: 'en' });
  });

  it('1053 request carries what LocalBusiness::user_register requires', () => {
    const body = new TokenService(client(fakeFetch({}))).buildRegisterRequest('qa-runner-eur-w01', 'pw', 'EUR');
    expect(body).toMatchObject({ opType: 1053, username: 'qa-runner-eur-w01', password: 'pw', email: 'qa-runner-eur-w01@qa-runner.test', currency: 'EUR' });
    expect(body.extra_params).toBeTruthy();
  });

  it('parses the token (plain string) and fails when missing', async () => {
    expect(parseTokenResponse('1e5e5ad8-a2b09164')).toBe('1e5e5ad8-a2b09164');
    expect(parseTokenResponse({ token: 'x1' })).toBe('x1');
    expect(parseTokenResponse(true)).toBe('');
    await expect(new TokenService(client(fakeFetch({ [ENDPOINT]: envelope(true) }))).login(player, 'EUR', 'en')).rejects.toThrow('token');
  });

  it('treats "already registered" as an existing player', async () => {
    const svc = new TokenService(client(fakeFetch({ [ENDPOINT]: envelope('Username or email address already registered.', false) })));
    expect(await svc.register('u', 'pw', 'EUR')).toEqual({ created: false });
  });
});

describe('PlayerProvisioner', () => {
  function aggregator(opts: { local: boolean }) {
    const registered = new Map<string, string>();
    const bodies: Array<Record<string, unknown>> = [];
    let n = 0;
    const f = fakeFetch({
      [ENDPOINT]: (_u, init) => {
        const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(b);
        if (b.opType === 1053) {
          registered.set(String(b.username), md5(String(b.password)));
          return envelope({ id: 1, user_id: null, username: b.username, currency: { code: 'EUR' } });
        }
        if (opts.local && registered.get(String(b.username)) !== b.md5) return envelope('Username or password incorrect.', false);
        return envelope(`tok-${String(++n).padStart(8, '0')}`);
      },
    });
    return { f, bodies };
  }

  it('registers the player with 1053 when 1050 rejects it, then logs in with md5(password)', async () => {
    const { f, bodies } = aggregator({ local: true });
    const redactor = new Redactor();
    const p = new PlayerProvisioner(client(f), { apiKey: 'secret-key-1', lang: 'en', prefix: 'qa-runner', redactor });
    const s1 = await p.createSession('EUR', 1);
    expect(bodies.map((b) => b.opType)).toEqual([1050, 1053, 1050]);
    expect(s1.username).toBe('qa-runner-eur-w01');
    expect(bodies[2]!.md5).toBe(md5(String(bodies[1]!.password)));
    // second session: straight login, same player, new token
    const s2 = await p.createSession('EUR', 1);
    expect(bodies.map((b) => b.opType)).toEqual([1050, 1053, 1050, 1050]);
    expect(s2.token).not.toBe(s1.token);
    // one player per currency and per worker
    expect((await p.createSession('USD', 1)).username).toBe('qa-runner-usd-w01');
    expect((await p.createSession('EUR', 2)).username).toBe('qa-runner-eur-w02');
    // aggregator gave EUR to the USD player → recorded
    expect(p.assignedCurrency.get('qa-runner-usd-w01')).toBe('EUR');
    // password never leaks
    expect(redactor.text(String(bodies[1]!.password))).toBe('***');
  });

  it('is deterministic across runs (same prefix → same password → login works without re-registering)', () => {
    const a = new PlayerProvisioner(client(fakeFetch({})), { apiKey: 'k', lang: 'en', prefix: 'qa-runner' }).playerFor('EUR', 1);
    const b = new PlayerProvisioner(client(fakeFetch({})), { apiKey: 'k', lang: 'en', prefix: 'qa-runner' }).playerFor('EUR', 1);
    expect(a.md5).toBe(b.md5);
    expect(a.password).toBe(derivePassword('k', 'qa-runner-eur-w01'));
  });

  it('feedh-style partners: 1050 works directly, no 1053', async () => {
    const { f, bodies } = aggregator({ local: false });
    await new PlayerProvisioner(client(f), { apiKey: 'k', lang: 'en' }).createSession('GBP', 3);
    expect(bodies.map((b) => b.opType)).toEqual([1050]);
  });

  it('existing players win over automatic ones and are never registered', async () => {
    const { f, bodies } = aggregator({ local: false });
    const p = new PlayerProvisioner(client(f), { apiKey: 'k', lang: 'en', existing: { EUR: { username: 'real', userId: '1', md5: 'abc' } } });
    await p.createSession('EUR', 1);
    expect(bodies[0]).toMatchObject({ username: 'real', user_id: '1', md5: 'abc' });
  });

  it('builds partner or front launch URLs', () => {
    const p = new PlayerProvisioner(client(fakeFetch({})), { apiKey: 'k', lang: 'en' });
    expect(p.buildLaunchUrl(4182, 'tok')).toBe(`${BASE}/alpha-test/launch/4182/tok?lang=en`);
    p.launchMode = 'front';
    expect(p.buildLaunchUrl(4182, 'tok')).toBe(`${BASE}/front/launcher/4182/tok?lang=en`);
  });

  it('detects the front launcher when the documented one rejects site sessions', async () => {
    const f = fakeFetch({
      [`${BASE}/alpha-test/launch/`]: { body: '<html>The requested session does not exist or is no longer available.</html>' },
      [ENDPOINT]: envelope('site-token-1234'),
    });
    const p = new PlayerProvisioner(client(f), { apiKey: 'k', lang: 'en' });
    expect(await p.detectLaunchMode(4182, 'EUR', f)).toBe('front');
  });
});

describe('1071 currency formats', () => {
  it.each([
    [['eur', 'USD'], ['EUR', 'USD']],
    ['EUR, USD|GBP', ['EUR', 'USD', 'GBP']],
    [[{ code: 'EUR' }, { currency: 'usd' }, { iso: 'GBP', name: 'Pound' }], ['EUR', 'USD', 'GBP']],
    [{ EUR: { min: 0.1 }, USD: true, GBP: false }, ['EUR', 'USD']],
    [null, []],
  ])('%j → %j', async (input, expected) => {
    const { parseCurrencyList } = await import('../../src/aggregator/GameService.js');
    expect(parseCurrencyList(input)).toEqual(expected);
  });

  it('reads alternative field names', () => {
    expect(parseGames([{ id: 1, name: 'x', provider: 'p', currency: ['EUR'] }])[0]!.currencies).toEqual(['EUR']);
  });
});

