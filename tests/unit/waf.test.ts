import { describe, expect, it } from 'vitest';
import { isWafChallenge } from '../../src/qa/detectors/WafDetector.js';
import { LaunchChainFollower } from '../../src/qa/launch/LaunchChainFollower.js';
import { BrowserLaunchEvaluator, evaluateChain } from '../../src/qa/tests/LaunchTest.js';
import { Redactor } from '../../src/util/Redactor.js';
import { fakeFetch } from '../helpers/fakeFetch.js';
import { frame, snapshot } from '../helpers/snapshot.js';

const CF_PAGE = '<html><head><title>Just a moment...</title></head><body>integration.playgg.uno Performing security verification <script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>';

describe('Cloudflare / WAF challenge', () => {
  it('is recognised from text, markup or URL', () => {
    expect(isWafChallenge({ text: 'integration.playgg.uno\nPerforming security verification\nThis website uses a security service to protect against malicious bots.' })).toBe(true);
    expect(isWafChallenge({ html: CF_PAGE })).toBe(true);
    expect(isWafChallenge({ url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0' })).toBe(true);
    expect(isWafChallenge({ text: 'Crazy Time — place your bets' })).toBe(false);
  });

  it('HTTP level: a 403 challenge page is REVIEW (not a game FAIL)', async () => {
    const chain = await new LaunchChainFollower({ timeoutMs: 1000, redactor: new Redactor(), fetchImpl: fakeFetch({ 'https://agg.test/p/launch/1/t': { status: 403, body: CF_PAGE } }) }).follow('https://agg.test/p/launch/1/t');
    expect(chain.outcome).toBe('WAF_BLOCKED');
    const e = evaluateChain(chain);
    expect(e.check.status).toBe('REVIEW');
    expect(e.errors[0]).toMatchObject({ type: 'WAF_BLOCKED', warning: true });
  });

  it('sends the access header only to the own hosts', async () => {
    const f = fakeFetch({
      'https://agg.test/p/launch/1/t': { body: '<html><iframe src="https://provider.test/game"></iframe></html>' },
      'https://provider.test/game': { body: '<html><canvas></canvas><script></script></html>' },
    });
    await new LaunchChainFollower({ timeoutMs: 1000, fetchImpl: f, hostHeaders: { hosts: ['agg.test'], headers: { 'X-QA-Runner': 'secret' } } }).follow('https://agg.test/p/launch/1/t');
    const h = (i: number) => f.calls[i]!.init?.headers as Record<string, string>;
    expect(h(0)['X-QA-Runner']).toBe('secret');
    expect(h(1)['X-QA-Runner']).toBeUndefined();
  });

  it('browser level: challenge still visible → REVIEW; challenge + rendered game → not blocked', () => {
    const ev = new BrowserLaunchEvaluator();
    const blocked = snapshot({ mainStatus: 403, frames: [frame('Performing security verification', { isMain: true, depth: 0, visibleCanvasCount: 0, elementCount: 47 }), frame('', { url: 'https://challenges.cloudflare.com/x', visibleCanvasCount: 0, elementCount: 12 })] });
    expect(ev.evaluate(blocked).check.status).toBe('REVIEW');
    expect(ev.evaluate(blocked).errors[0]!.type).toBe('WAF_BLOCKED');
    const passed = snapshot({ mainStatus: 200, frames: [frame('', { url: 'https://challenges.cloudflare.com/x', visibleCanvasCount: 0 }), frame('', { visibleCanvasCount: 1 })] });
    expect(ev.evaluate(passed).check.status).toBe('PASS');
  });
});
