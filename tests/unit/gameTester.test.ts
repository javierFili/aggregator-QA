import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AggregatorClient } from '../../src/aggregator/AggregatorClient.js';
import { PlayerProvisioner } from '../../src/aggregator/PlayerProvisioner.js';
import { createDefaultDetectorRegistry } from '../../src/qa/detectors/DetectorRegistry.js';
import { EvidenceWriter } from '../../src/qa/EvidenceWriter.js';
import { GameTester } from '../../src/qa/GameTester.js';
import { LaunchChainFollower } from '../../src/qa/launch/LaunchChainFollower.js';
import { parseRunConfig } from '../../src/qa/QaConfig.js';
import type { RunServices } from '../../src/qa/TestContext.js';
import { createLogger } from '../../src/util/logger.js';
import { envelope, fakeFetch } from '../helpers/fakeFetch.js';

const BASE = 'https://integration.example.test';
const dirs: string[] = [];
afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

async function services(options: Record<string, unknown> = {}): Promise<RunServices> {
  const f = fakeFetch({
    [`${BASE}/alpha-test/launch/4170/`]: { body: '<html><iframe src="https://s-endpoint.royal7.test/launch/?token=p"></iframe></html>' },
    'https://s-endpoint.royal7.test/launch/': { body: { error: { code: -1, description: 'Error: Game not found' } } },
    [`${BASE}/alpha-test/launch/4182/`]: { body: '<html><iframe src="https://evo.test/game"></iframe></html>' },
    'https://evo.test/game': { body: '<html><script src="a.js"></script><canvas></canvas></html>' },
    [`${BASE}/alpha-test`]: envelope({ token: 'x' }),
  });
  // unique tokens per 1050 call
  let n = 0;
  const tokenFetch = (async (url: string, init?: RequestInit) => (url === `${BASE}/alpha-test` ? new Response(JSON.stringify({ status: true, message: { token: `tok${++n}xxxxxxxx` } })) : f(url, init))) as typeof fetch;
  const config = parseRunConfig({ aggregatorUrl: BASE, partnerCode: 'alpha-test', apiKey: 'k-secret', currencies: ['GBP', 'BRL'], options: { browserCheck: false, ...options }, expectedLimits: { min: '0.10' } }, { defaultWorkers: 5, maxWorkers: 20 });
  const client = new AggregatorClient({ baseUrl: BASE, partnerCode: 'alpha-test', apiKey: 'k-secret', timeoutMs: 1000, fetchImpl: tokenFetch });
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-run-'));
  dirs.push(dir);
  const evidence = new EvidenceWriter(dir);
  await evidence.init();
  return {
    config,
    client,
    players: new PlayerProvisioner(client, { apiKey: 'k-secret', lang: 'en' }),
    follower: new LaunchChainFollower({ timeoutMs: 1000, fetchImpl: tokenFetch }),
    detectors: createDefaultDetectorRegistry(),
    evidence,
    timeouts: { browserMs: 1000, settleMs: 0 },
    log: createLogger('test'),
  };
}

const game = (id: number, name: string) => ({ id, name, provider: 'p', device: ['desktop'], currencies: ['GBP', 'EUR'] });

describe('GameTester (HTTP level, no browser)', () => {
  it('4170: HTTP 200 + JSON error → FAIL with diagnostics', async () => {
    const s = await services();
    const r = await new GameTester(s).test(game(4170, 'XXXTreme Lightning Roulette'), 'GBP');
    expect(r.launch.status).toBe('FAIL');
    expect(r.overall).toBe('FAIL');
    expect(r.errors[0]).toMatchObject({ step: 'provider-launch', type: 'SEMANTIC_ERROR', httpStatus: 200 });
    expect(r.currencyCheck.status).toBe('SKIPPED');
    expect(r.minLimit.status).toBe('SKIPPED');
    expect(r.diagnostics).toBe('diagnostics/4170_GBP.json');
    const diag = await readFile(path.join(s.evidence.runDir, r.diagnostics!), 'utf8');
    expect(diag).toContain('Game not found');
    expect(diag).not.toContain('tok1xxxxxxxx');
    expect(diag).not.toContain('k-secret');
  });

  it('4182: chain loads → PASS (browser-only checks skipped)', async () => {
    const r = await new GameTester(await services()).test(game(4182, 'Crazy Time'), 'GBP');
    expect(r.launch.status).toBe('PASS');
    expect(r.currencyCheck).toMatchObject({ status: 'SKIPPED', detail: 'Requiere verificación en navegador' });
    expect(r.overall).toBe('PASS');
    expect(r.diagnostics).toBeUndefined();
  });

  it('undeclared currency is NOT_DECLARED/SKIPPED unless enabled', async () => {
    const r = await new GameTester(await services()).test(game(4182, 'Crazy Time'), 'BRL');
    expect(r.currencyCheck.status).toBe('NOT_DECLARED');
    expect(r.launch.status).toBe('SKIPPED');
    expect(r.overall).toBe('SKIPPED');
    const forced = await new GameTester(await services({ testUndeclaredCurrencies: true })).test(game(4182, 'Crazy Time'), 'BRL');
    expect(forced.launch.status).toBe('PASS');
    expect(forced.declared).toBe(false);
  });

  it('a game whose 1071 entry has no currencies is tested anyway (not skipped)', async () => {
    const r = await new GameTester(await services()).test({ ...game(4182, 'Crazy Time'), currencies: [] }, 'GBP');
    expect(r.launch.status).toBe('PASS');
    expect(r.overall).not.toBe('SKIPPED');
    expect(r.declared).toBe(false);
  });

  it('a 1050 failure is a FAIL for that game only', async () => {
    const s = await services();
    const broken = new AggregatorClient({ baseUrl: BASE, partnerCode: 'alpha-test', apiKey: 'k', timeoutMs: 1000, fetchImpl: fakeFetch({ [`${BASE}/alpha-test`]: envelope('ERR-0005: Currency not allowed', false) }) });
    s.players = new PlayerProvisioner(broken, { apiKey: 'k', lang: 'en' });
    const r = await new GameTester(s).test(game(4182, 'Crazy Time'), 'GBP');
    expect(r.launch.status).toBe('FAIL');
    expect(r.errors[0]).toMatchObject({ step: 'session' });
  });
});
