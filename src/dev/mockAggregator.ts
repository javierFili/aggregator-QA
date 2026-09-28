import { createHash, randomUUID } from 'node:crypto';
import express, { type Express } from 'express';

/**
 * Development-only fake aggregator + providers, reproducing the two reference cases of the spec:
 *  - 4182 "Crazy Time": launch HTML → iframe → provider HTML with GAMEDATA.url → game frontend (canvas + bet controls)
 *  - 4170 "XXXTreme Lightning Roulette": launch HTML → iframe → provider returns HTTP 200 JSON {"error":{"code":-1,"description":"Error: Game not found"}}
 *  - 4200 "Blank Slot": frontend that renders nothing (→ REVIEW)
 * Never used by the real tool; only by e2e tests, `npm run mock:aggregator` and manual demos.
 */
export const MOCK_API_KEY = 'mock-api-key-123456';

export interface MockOptions {
  /** Limits rendered by the working game. */
  limits?: { min: number; default: number; max: number };
  /**
   * `feedh` (default): 1050 creates unknown players on the fly and returns a game session token.
   * `local`: like the aggregator's LocalBusiness (Local/IntWallet drivers): players must be registered with 1053
   * (stored as md5(password)); 1050 requires username + md5(password), ignores currency, and returns a *site*
   * session that only `/front/launcher/{gid}/{token}` accepts. Registered players always get EUR (currency id 1).
   */
  driver?: 'feedh' | 'local';
  /**
   * Seamless partner: before opening a game, ask this wallet endpoint for the balance (2051), like the real
   * aggregator does; if it does not answer `{status:true,message:<number>}` the launch shows
   * "get_game failed: ERROR: GetBalance Seamless failed."
   */
  walletUrl?: string;
  /** How long the working game shows its loading screen before balance/currency appear (default 3000 ms). */
  loadingMs?: number;
  /** Put a fake Cloudflare challenge in front of the launchers; this header/value lets the QA tool through. */
  waf?: { header: string; value: string };
  /** Mimic aggregators whose 1071 has no `currencies` field and filters by the `currency` parameter instead. */
  currencyViaParameter?: boolean;
}

export function createMockAggregator(options: MockOptions = {}): Express {
  const limits = options.limits ?? { min: 0.1, default: 1, max: 100 };
  const app = express();
  app.use(express.json());
  const sessions = new Map<string, { currency: string; userId: string }>();
  const players = new Map<string, { passwordMd5: string; currency: string }>();
  const siteSessions = new Map<string, { username: string }>();

  if (options.waf) {
    const { header, value } = options.waf;
    app.use(['/:partner/launch', '/front/launcher'], (req, res, next) => {
      if (req.get(header) === value) return next();
      res.status(403).type('html').send(`<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><h1>integration.playgg.uno</h1>
        <p>Performing security verification</p><p>This website uses a security service to protect against malicious bots.</p>
        <iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/x/normal"></iframe></body></html>`);
    });
  }

  app.post('/:partner', (req, res) => {
    if (req.get('Api-Key') !== MOCK_API_KEY) {
      res.json({ status: false, message: 'ERR-0001: Invalid Api-Key.' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    switch (body.opType) {
      case 1070:
        res.json({ status: true, message: [
          { id: 1, code: 'evolution', name: 'Evolution', image: '' },
          { id: 2, code: 'royal7', name: 'Royal 7', image: '' },
          { id: 3, code: 'blank', name: 'Blank Games', image: '' },
        ] });
        return;
      case 1071: {
        const all = [
          { id: 4182, name: 'Crazy Time', media: '', provider: 'evolution', device: ['desktop', 'mobile'], currencies: ['EUR', 'USD', 'GBP'] },
          { id: 4170, name: 'XXXTreme Lightning Roulette', media: '', provider: 'royal7', device: ['desktop', 'mobile'], currencies: ['EUR', 'USD', 'GBP'] },
          { id: 4200, name: 'Blank Slot', media: '', provider: 'blank', device: ['desktop'], currencies: ['EUR'] },
        ];
        if (!options.currencyViaParameter) {
          res.json({ status: true, message: all });
          return;
        }
        const currency = typeof body.currency === 'string' ? body.currency : undefined;
        const games = all.filter((g) => !currency || g.currencies.includes(currency)).map(({ currencies: _c, ...g }) => g);
        res.json({ status: true, message: games });
        return;
      }
      case 1053: {
        if (options.driver !== 'local') {
          res.json({ status: false, message: 'ERR-0000: Generic error.' });
          return;
        }
        if (typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
          res.json({ status: false, message: 'Invalid email address.' });
          return;
        }
        if (!body.username || !body.password) {
          res.json({ status: false, message: 'Undefined username.' });
          return;
        }
        if (players.has(String(body.username))) {
          res.json({ status: false, message: 'Username or email address already registered.' });
          return;
        }
        if (!body.extra_params) {
          res.json({ status: false, message: 'Registration cannot be completed because data is missing.' });
          return;
        }
        players.set(String(body.username), { passwordMd5: createHash('md5').update(String(body.password)).digest('hex'), currency: 'EUR' });
        res.json({ status: true, message: { id: players.size, user_id: null, username: body.username, currency: { code: 'EUR', name: 'Euro', decimals: 2 }, balance: 0 } });
        return;
      }
      case 1050: {
        const token = randomUUID().replace(/-/g, '').replace(/(.{8})(?!$)/g, '$1-');
        if (options.driver === 'local') {
          const player = players.get(String(body.username));
          if (!player || player.passwordMd5 !== body.md5) {
            res.json({ status: false, message: 'Username or password incorrect.' });
            return;
          }
          // closeAllSessionsSite()
          for (const [t, s] of siteSessions) if (s.username === body.username) siteSessions.delete(t);
          siteSessions.set(token, { username: String(body.username) });
          res.json({ status: true, message: token });
          return;
        }
        if (!body.currency) {
          res.json({ status: false, message: 'ERR-0002: Missing parameters.' });
          return;
        }
        sessions.set(token, { currency: String(body.currency), userId: String(body.user_id) });
        res.json({ status: true, message: token });
        return;
      }
      default:
        res.json({ status: false, message: 'ERR-0000: Generic error.' });
    }
  });

  // Aggregator launcher
  const renderLaunch = (res: express.Response, gameId: string, token: string, session: { currency: string; userId: string }): void => {
    const providerToken = `pt${token}`;
    sessions.set(providerToken, session);
    const iframe =
      gameId === '4170'
        ? `/royal7/launch/?token=${providerToken}`
        : gameId === '4200'
          ? `/blank/launch?token=${providerToken}`
          : `/evo-launcher/launch?token=${providerToken}`;
    res.type('html').send(`<!doctype html><html><head><title>Game</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style></head><body><iframe src="${iframe}" allowfullscreen></iframe></body></html>`);
  };

  app.get('/:partner/launch/:gameId/:token', async (req, res) => {
    const session = sessions.get(req.params.token);
    if (session && options.walletUrl) {
      const balance = await fetch(options.walletUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Playgg/Integration', 'Api-Key': MOCK_API_KEY },
        body: JSON.stringify({ opType: 2051, token: req.params.token, user_id: session.userId }),
      })
        .then((r) => r.json() as Promise<{ status?: boolean; message?: unknown }>)
        .catch(() => null);
      if (!balance?.status || typeof balance.message !== 'number') {
        res.type('html').send('<html><body>PLAYGG [Spin2Win] get_game failed: ERROR: GetBalance Seamless failed.<br>ERROR</body></html>');
        return;
      }
    }
    if (!session) {
      // what AbstractPartnerAdapter::launch() displays for a token that is not a game session
      res.type('html').send('<html><body><div class="message">The requested session does not exist or is no longer available.</div></body></html>');
      return;
    }
    renderLaunch(res, req.params.gameId, req.params.token, session);
  });

  // FrontController: turns a site session (Local/IntWallet 1050) into a game session and launches
  app.get('/front/launcher/:gameId/:token', (req, res) => {
    const site = siteSessions.get(req.params.token);
    if (!site) {
      res.type('html').send('Session not found');
      return;
    }
    const gameToken = randomUUID();
    const session = { currency: players.get(site.username)?.currency ?? 'EUR', userId: site.username };
    sessions.set(gameToken, session);
    renderLaunch(res, req.params.gameId, gameToken, session);
  });

  // Royal7: HTTP 200 + JSON semantic error
  app.get('/royal7/launch/', (_req, res) => {
    res.json({ error: { code: -1, description: 'Error: Game not found' } });
  });

  // Blank provider: an app shell that never renders anything
  app.get('/blank/launch', (_req, res) => {
    res.type('html').send('<!doctype html><html><head><script>/* nothing */</script></head><body></body></html>');
  });

  // Evolution-like launcher exposing GAMEDATA.url
  app.get('/evo-launcher/launch', (req, res) => {
    const token = String(req.query.token ?? '');
    res.type('html').send(`<!doctype html><html><head><script>
      var GAMEDATA = {"url": "/evo/game/crazytime?session=${token}", "provider": "evolution"};
      window.location.href = GAMEDATA.url;
    </script></head><body>Loading…</body></html>`);
  });

  app.get('/evo/api/config', (req, res) => {
    const session = sessions.get(String(req.query.session ?? ''));
    res.json({ player: { currency: session?.currency ?? 'EUR', balance: 0 }, betLimits: { min: limits.min, max: limits.max, default: limits.default } });
  });

  app.get('/evo/game/crazytime', (req, res) => {
    const session = sessions.get(String(req.query.session ?? ''));
    if (!session) {
      res.status(401).type('html').send('<html><body>Session expired</body></html>');
      return;
    }
    const symbol = { EUR: '€', GBP: '£', USD: '$' }[session.currency] ?? session.currency;
    res.type('html').send(`<!doctype html><html><head><title>Crazy Time</title></head><body style="margin:0;background:#1b0f3b;color:#fff;font-family:sans-serif">
      <canvas id="stage" width="900" height="500" style="display:block"></canvas>
      <div id="loading" style="padding:8px">Loading 0%</div>
      <div class="hud" id="hud" style="padding:8px;display:none">
        <span class="balance">Balance ${symbol}0.00</span>
        <label>Bet <input id="bet-amount" name="bet" type="number" min="${limits.min}" max="${limits.max}" value="${limits.default}" step="0.1" aria-label="Bet amount"></label>
        <span class="limits">Min bet ${symbol}${limits.min.toFixed(2)} · Max bet ${symbol}${limits.max.toFixed(2)}</span>
      </div>
      <script>
        // like real games: a loading screen is painted first, the game (balance, currency, bets) appears later
        const c = document.getElementById('stage').getContext('2d');
        c.fillStyle = '#333'; c.fillRect(0, 0, 900, 500);
        setTimeout(() => {
          c.fillStyle = '#f5c518'; c.beginPath(); c.arc(450, 250, 200, 0, Math.PI * 2); c.fill();
          document.getElementById('loading').style.display = 'none';
          document.getElementById('hud').style.display = '';
          fetch('/evo/api/config?session=${encodeURIComponent(String(req.query.session))}').then(r => r.json());
        }, ${options.loadingMs ?? 3000});
      </script>
    </body></html>`);
  });

  return app;
}
