import { describe, expect, it } from 'vitest';
import { extractGameDataUrl, findNextHop, visibleText } from '../../src/qa/launch/HtmlInspector.js';
import { LaunchChainFollower } from '../../src/qa/launch/LaunchChainFollower.js';
import { evaluateChain } from '../../src/qa/tests/LaunchTest.js';
import { Redactor } from '../../src/util/Redactor.js';
import { fakeFetch } from '../helpers/fakeFetch.js';

const LAUNCH = 'https://integration.example.test/alpha-test/launch';
const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';

function follower(f: ReturnType<typeof fakeFetch>, redactor = new Redactor()) {
  return new LaunchChainFollower({ timeoutMs: 1000, fetchImpl: f, redactor });
}

describe('HtmlInspector', () => {
  it('finds iframes, GAMEDATA urls, meta refresh and JS redirects', () => {
    expect(findNextHop('<iframe src="https://p.test/launch/?token=x&amp;a=1"></iframe>')).toEqual({ kind: 'iframe', url: 'https://p.test/launch/?token=x&a=1' });
    expect(findNextHop('<script>var GAMEDATA = {"url":"https:\\/\\/evo.test\\/game?t=1"};</script>')).toEqual({ kind: 'gamedata-url', url: 'https://evo.test/game?t=1' });
    expect(findNextHop('<meta http-equiv="refresh" content="0; url=https://x.test/next">')).toEqual({ kind: 'meta-refresh', url: 'https://x.test/next' });
    expect(findNextHop('<script>window.location.href = "/go";</script>')).toEqual({ kind: 'js-location', url: '/go' });
    expect(findNextHop('<iframe src="about:blank"></iframe><div>game</div>')).toBeUndefined();
  });

  it('parses JS-object GAMEDATA', () => {
    expect(extractGameDataUrl("<script>GAMEDATA = { url: 'https://evo.test/x', other: 1 };</script>")).toBe('https://evo.test/x');
  });

  it('extracts visible text only', () => {
    expect(visibleText('<html><script>var a="error"</script><style>.x{}</style><h1>Hello &amp; bye</h1></html>')).toBe('Hello & bye');
  });
});

describe('LaunchChainFollower', () => {
  it('KNOWN FAILING CASE 4170: HTTP 200 everywhere but provider JSON error → FAIL', async () => {
    const f = fakeFetch({
      [`${LAUNCH}/4170/`]: { body: '<html><body><iframe src="https://s-endpoint.royal7.test/launch/?token=prov123456"></iframe></body></html>' },
      'https://s-endpoint.royal7.test/launch/': { body: { error: { code: -1, description: 'Error: Game not found' } } },
    });
    const chain = await follower(f).follow(`${LAUNCH}/4170/${TOKEN}?lang=en`);
    expect(chain.outcome).toBe('SEMANTIC_ERROR');
    expect(chain.hops.map((h) => h.status)).toEqual([200, 200]);
    expect(chain.hops[1]!.via).toBe('iframe');
    expect(chain.hops[1]!.contentType).toContain('application/json');

    const evaluation = evaluateChain(chain);
    expect(evaluation.check.status).toBe('FAIL');
    expect(evaluation.errors[0]).toMatchObject({ step: 'provider-launch', type: 'SEMANTIC_ERROR', httpStatus: 200, code: -1 });
    expect(evaluation.errors[0]!.description).toContain('Game not found');
    // tokens never leak into the recorded URLs
    expect(JSON.stringify(chain)).not.toContain(TOKEN);
    expect(JSON.stringify(chain)).not.toContain('prov123456');
  });

  it('KNOWN WORKING CASE 4182: launch → iframe → provider HTML → GAMEDATA.url → frontend → PASS', async () => {
    const f = fakeFetch({
      [`${LAUNCH}/4182/`]: { body: '<html><body><iframe src="/provider/evo?token=p1"></iframe></body></html>' },
      'https://integration.example.test/provider/evo': { body: '<html><script>var GAMEDATA = {"url":"https://evo.test/api/launch/game?token=zzz"};</script></html>' },
      'https://evo.test/api/launch/game': { status: 302, headers: { location: '/frontend/index.html' }, body: '' },
      'https://evo.test/frontend/index.html': { body: '<!doctype html><html><head><script src="app.js"></script></head><body><div id="root"></div></body></html>' },
    });
    const chain = await follower(f).follow(`${LAUNCH}/4182/${TOKEN}`);
    expect(chain.outcome).toBe('LOADED');
    expect(chain.hops.map((h) => h.via)).toEqual(['start', 'iframe', 'gamedata-url', 'redirect']);
    expect(evaluateChain(chain).check.status).toBe('PASS');
  });

  it('flags HTTP errors, empty pages and error pages', async () => {
    const f = fakeFetch({
      'https://a.test/404': { status: 404, body: '<html>Not found</html>' },
      'https://a.test/empty': { body: '<html><body></body></html>' },
      'https://a.test/msg': { body: '<html><body><h1>Invalid token</h1></body></html>' },
      'https://a.test/loop': { status: 302, headers: { location: 'https://a.test/loop' }, body: '' },
    });
    const fo = follower(f);
    expect((await fo.follow('https://a.test/404')).outcome).toBe('HTTP_ERROR');
    expect((await fo.follow('https://a.test/empty')).outcome).toBe('EMPTY');
    expect(evaluateChain(await fo.follow('https://a.test/empty')).check.status).toBe('REVIEW');
    const msg = await fo.follow('https://a.test/msg');
    expect(msg.outcome).toBe('SEMANTIC_ERROR');
    expect(msg.semanticError?.category).toBe('INVALID_TOKEN');
    expect((await fo.follow('https://a.test/loop')).outcome).toBe('TOO_MANY_HOPS');
    expect((await fo.follow('https://unreachable.test/')).outcome).toBe('NETWORK_ERROR');
  });

  it('follows JSON launch responses with a url field', async () => {
    const f = fakeFetch({
      'https://a.test/json': { body: { url: 'https://a.test/game' } },
      'https://a.test/game': { body: '<html><canvas></canvas><script></script></html>' },
    });
    const chain = await follower(f).follow('https://a.test/json');
    expect(chain.outcome).toBe('LOADED');
    expect(chain.hops[1]!.via).toBe('json-url');
  });
});
