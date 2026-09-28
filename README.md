# iGaming QA Runner

A **local-only** tool that automates QA of the games imported into an iGaming aggregator.
It loads the catalogue through the partner API (`1070` / `1071`), creates a player session for every
launch (`1050`), follows the whole launch chain (aggregator → iframe → provider → game frontend), opens each
game in Chromium, checks currencies and betting limits, shows progress live, and exports an Excel report
with evidence (screenshots and diagnostic JSON).

It acts only as an **external API/browser client**. It never touches the aggregator codebase, databases,
Redis, Docker Swarm or provider infrastructure, and it **never places bets** (`2052` is not used).

> The UI is in Spanish. Spanish docs: a detailed step-by-step manual in [`docs/MANUAL_ES.md`](docs/MANUAL_ES.md) and a short guide in [`docs/USER_GUIDE_ES.md`](docs/USER_GUIDE_ES.md).

---

## 1. Requirements

- Node.js **20.10+** (developed on Node 20; Node 22 LTS works too)
- npm 10+
- Linux, macOS or Windows with the system libraries Chromium needs
  (on Linux, `npx playwright install-deps chromium` installs them)
- Network access to the aggregator and the providers' game servers
- An **authorized** test partner (partner code + API key)

No database, Redis, Docker or any other service is required.

## 2. Installation

```bash
npm install
npm run playwright:install      # downloads Playwright's Chromium (one time)
cp .env.example .env            # optional, defaults are fine
```

## 3. Environment variables

All optional. `.env` is git-ignored — **never commit it**.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Keep it on localhost. |
| `PORT` | `3000` | HTTP port of the UI. |
| `PLAYWRIGHT_HEADLESS` | `true` | `false` shows the browser (useful for debugging a provider). |
| `DEFAULT_WORKERS` | `5` | Workers pre-filled in the UI. |
| `MAX_WORKERS` | `20` | Hard upper limit for workers. |
| `REQUEST_TIMEOUT` | `30000` | ms, every HTTP request (API and launch chain hops). |
| `BROWSER_TIMEOUT` | `45000` | ms, browser navigation to a game. |
| `GAME_SETTLE_TIMEOUT` | `10000` | ms, max wait for network idle after the game loads. |
| `REPORTS_DIR` | `reports` | Where run folders are written. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `QA_AGGREGATOR_URL`, `QA_PARTNER_CODE`, `QA_API_KEY`, `QA_LAUNCHER_URL` | – | Only for `npm run integration`. |

The API key entered in the UI is **never** written to disk; it lives in memory only for the current request/run.

## 4. Starting the application

```bash
npm run dev          # development, auto-reload (tsx watch)
# or
npm run build && npm start
```

Open **http://127.0.0.1:3000**.

### Try it without a real partner

A fake aggregator reproducing the reference cases is included for demos:

```bash
npm run mock:aggregator          # http://127.0.0.1:4000, Api-Key: mock-api-key-123456
```

In the UI use URL `http://127.0.0.1:4000`, partner `alpha-test`, API key `mock-api-key-123456`.
It serves 4182 *Crazy Time* (works), 4170 *XXXTreme Lightning Roulette* (HTTP 200 + JSON error → FAIL)
and 4200 *Blank Slot* (renders nothing → REVIEW).

## 5. Configuring a partner

| Field | Example |
|---|---|
| Integration endpoint | `https://integration.playgg.uno/alpha-test` — the partner code is taken from the last path segment; requests go to `POST {url}/{partner}` |
| Launcher URL (optional) | defaults to the aggregator URL; launch URLs are `{launcher}/{partner}/launch/{gameId}/{token}?lang=xx` |
| Partner code | `alpha-test` |
| API Key | sent as the `Api-Key` header |

1. **Cargar juegos** calls `1070` and `1071` and shows provider/game counts and the currencies present in the catalogue.
2. Optionally restrict the run by provider, by game IDs (e.g. `4182, 4170`) or to the first N games.
3. **Iniciar QA** starts the run; **Detener** stops it; **Descargar Excel** exports (also partial runs).

### QA players and sessions (how the aggregator really works)

Derived from the aggregator source (`backend/src/Business/LocalBusiness.php`, `FeedhBusiness.php`,
`apps/integrator/src/Controller/FrontController.php`) — read-only, nothing in the aggregator is modified:

- **Feedh-style partners**: `1050` creates unknown players on the fly and returns a *game* session token, opened with
  `{launcher}/{partner}/launch/{gid}/{token}` (the documented flow).
- **Local / IntWallet drivers** (e.g. `alpha-test`): `1050` only accepts players that already exist, comparing `md5`
  with the stored password (`md5(password)`); players are created with the undocumented **`1053` USER_REGISTER**
  (`username`, `email`, `password`, `extra_params`). `1050` then returns a *site* session that only
  `{aggregator}/front/launcher/{gid}/{token}` accepts. `1053` always assigns currency id 1 on these partners.

`PlayerProvisioner` (`src/aggregator/PlayerProvisioner.ts`) handles both automatically:

1. One QA player **per currency and per worker**: `qa-runner-eur-w01` (1050 closes the player's previous sessions,
   so workers must not share a player). The password is derived from the API key + username, so the same players
   are reused across runs without storing anything; it is registered with the redactor and never logged.
2. `1050` first; on `Username or password incorrect` → `1053` register → `1050` again.
3. Before the workers start, one game is opened with the documented launcher; if the aggregator answers
   *"The requested session does not exist…"*, the run switches to `/front/launcher`.
4. If the aggregator assigns the player a different currency than requested, those rows are REVIEW
   (`playerCurrency` in the result), never a silent PASS.
5. "Existing players" (`CURRENCY;username;user_id;md5`, advanced options) override the automatic ones.

No token is sent in `1050` (the aggregator issues a new one per launch, as the docs recommend). When `1071` has no
`currencies` field, it is queried once per selected currency (`{"opType":1071,"currency":"EUR"}`) to know which
games exist in each currency. The balance of these players is kept by the aggregator itself (local balance, 0 by
default); the tool never bets, so no balance is needed to check that games load.

The UI's **Probar conexión** button runs steps 1–3 for every selected currency without starting a QA run.

## 6. How a game is tested

```text
1050 session ─► Level 1: HTTP launch chain ─► 1050 session ─► Level 2: Chromium ─► currency ─► limits ─► evidence
```

**Level 1 — HTTP (fast).** Follows redirects, `<meta refresh>`, `<iframe src>`, `GAMEDATA.url`, JS
`location` assignments and JSON `{ "url": ... }` responses, hop by hop (max 8, loop detection, per-test
cookie jar). **HTTP 200 is never enough**: every JSON/text response goes through the
`SemanticErrorDetector`, and the chain must end on an HTML application page.

**Level 2 — Browser (Playwright).** One shared Chromium process; each test gets its own isolated
`BrowserContext` that is always closed afterwards. It captures: navigation documents of every frame (a frame
that loads `{"error":...}` is a FAIL), DOM/text of every frame, bet-related elements, ARIA values, JSON
responses (for currency/limit detection), console errors, page errors and failed requests. A game counts as
loaded when a frame shows a visible canvas, a video or a meaningful DOM.

**Verdict for the launch:**

| HTTP chain | Browser | Launch |
|---|---|---|
| semantic error (e.g. `Game not found`) | any | **FAIL** |
| other failure (403, network…) | loaded | REVIEW (not reproducible in a real browser) |
| any other | loaded / error / blank | browser decides: PASS / FAIL / REVIEW |

The browser level can be disabled (*Verificar en navegador*); then only Level 1 runs and currency/limit
runtime checks are `SKIPPED`.

### Reference cases

- **Crazy Time (4182)** — launch HTML → iframe → provider HTML → `GAMEDATA.url` → game frontend → **PASS**.
- **XXXTreme Lightning Roulette (4170)** — launch HTML (200) → iframe → provider endpoint (200,
  `application/json`) → `{"error":{"code":-1,"description":"Error: Game not found"}}` → **FAIL**
  (step `provider-launch`, HTTP 200, code −1).

Both are covered by unit tests (mocked HTTP) and by the e2e test (mock aggregator + real Chromium).

## 7. Currencies

Select currencies in the multi-select (catalogue currencies are suggested; any ISO 3-letter code can be
typed; codes are upper-cased and de-duplicated). For each game and each selected currency:

1. **Declaration** — is it in the game's `1071` `currencies`? If not, it is `NOT_DECLARED` and the row is
   `SKIPPED`, unless *Probar divisas no declaradas en 1071* is checked (then it is launched anyway and
   marked "No declarada en 1071").
2. **Runtime** — a session is created in that currency and the game is inspected by the currency detectors:
   - `network-json`: explicit fields such as `currency`, `currencyCode`, `ccy` in JSON responses (high confidence)
   - `visible-text`: ISO codes and unambiguous symbols (`£`, `€`, `R$`, `lei`…) in frame text/ARIA (low confidence)

| Detection | Check status |
|---|---|
| expected currency found | PASS |
| other currency in an explicit JSON field | FAIL |
| other currency only in text/symbols | REVIEW |
| nothing found | NOT_DETECTED (→ REVIEW, never FAIL) |
| provider rejected the currency (semantic error) | FAIL |

If *Probar divisas* is off, each game is tested once (first selected currency it declares, otherwise its
first declared currency) and the currency check is `SKIPPED`.

## 8. Limits

Min / default / max bet are optional; empty fields are not tested. The aggregator does not expose limits, so
they are read from the game itself by these detectors (priority order):

1. `network-json` — `minBet`, `maxBet`, `defaultBet`, `betLimits.{min,max,default}`… in JSON responses
2. `input-attributes` — `<input name="bet" min max value>` on bet-related controls
3. `dom-attributes` — `data-min`, `data-max`, `data-default`… on bet-related elements
4. `accessibility` — `aria-valuemin/max/now` on elements labelled as bet/stake
5. `visible-text` — "MIN BET 0.10", "Apuesta máxima 100,00 €", "Bet limits 0.10 - 100" (EN/ES/PT/RO/DE/FR/IT);
   a plain "BET 1.00" is used as the default bet with *low* confidence

Only the initial state is inspected; the tool never changes the bet or spins.

| Situation | Status |
|---|---|
| no expected value | SKIPPED |
| equal | PASS |
| different (high-confidence detection) | FAIL |
| different, low-confidence heuristic, or ×100 unit mismatch | REVIEW |
| not found | NOT_DETECTED (→ REVIEW, never FAIL) |

Many slots render everything into a `<canvas>`; for those, limits are usually `NOT_DETECTED` unless the game
exposes them in its network traffic. That is expected — add a provider-specific detector when needed (§14).

## 9. Overall result

Centralised in `computeOverall()` (`src/qa/TestResult.ts`):

- any FAIL in launch, currency or a limit → **FAIL**
- otherwise any REVIEW / NOT_DETECTED → **REVIEW**
- launch not executed (e.g. undeclared currency skipped) → **SKIPPED**
- otherwise → **PASS**

## 10. Workers

The queue contains the selected games; `N` workers (default 5, max `MAX_WORKERS`) take games one at a time.
A worker tests all currencies of its game, then takes the next game. Each test is isolated: an exception,
timeout or crash marks that game/currency as FAIL and the worker continues. **Detener** stops handing out
games, lets the running ones finish, closes the browser contexts and leaves a partial report.

Rule of thumb: each worker holds one Chromium context, so 10–20 workers need a few GB of RAM. Start with 5.

## 11. Reports and evidence

Each run creates:

```text
reports/2026-09-28_11-30-00/
├── QA_Report_2026-09-28_11-30-00.xlsx
├── screenshots/4170_GBP.png           # FAIL / REVIEW (or all, if enabled)
└── diagnostics/4170_GBP.json          # launch chain hops, frames, documents, console/network errors, detections
```

The Excel file has four sheets: **Summary** (partner, dates, duration, counts, configuration), **Results**
(one row per game × currency), **Errors** (step, type, HTTP status, content type, code, URL, description;
warnings included) and **Providers** (results per provider). Headers are frozen, filters enabled,
statuses coloured. The UI's *Detalle* dialog links to the screenshot and diagnostic of each row.

## 12. Troubleshooting

| Symptom | What to check |
|---|---|
| `Executable doesn't exist … chromium` | `npm run playwright:install` |
| Chromium fails to start on Linux | `npx playwright install-deps chromium` |
| `ERR-xxxx` when loading games | API key / partner code; the message comes from the aggregator |
| Everything times out | VPN / IP allow-listing of your machine at the aggregator or providers; raise `REQUEST_TIMEOUT` |
| Many `REVIEW` with `NOT_DETECTED` | normal for canvas games; look at `diagnostics/*.json` → `detection` and `browser.jsonResponses` to design a provider detector |
| `REVIEW: la cadena HTTP falló … pero el juego cargó` | the provider blocks non-browser clients; the browser result is the reliable one |
| Blank screenshots | raise `GAME_SETTLE_TIMEOUT`, or run with `PLAYWRIGHT_HEADLESS=false` to watch |
| Machine gets slow | lower the workers |
| `Forbidden host` | open the UI via `127.0.0.1`/`localhost`, not another hostname |

## 13. Security

- Binds to `127.0.0.1` by default; requests with a foreign `Host` header or cross-site `Origin` are rejected.
- The API key is kept in memory only; it is never persisted, logged or exported. The UI stores only
  non-secret preferences (URL, partner, currencies…) in the browser's `localStorage`.
- A central `Redactor` masks the API key, every generated token and md5, sensitive query parameters
  (`token`, `session`, `key`, `md5`, `sig`…), sensitive JSON keys and long opaque URL path segments in
  logs, diagnostics, the UI and the Excel file.
- User-supplied URLs are validated (http/https only, no credentials/query). The server only makes requests
  that belong to the QA workflow (the configured aggregator and the URLs of the launch chains it returns).
- No real-money operations: `2052` and any other wallet/transfer operation are not implemented.

## 14. Architecture

```text
src/
├── config/environment.ts          env parsing (.env)
├── aggregator/                    partner API client
│   ├── AggregatorClient.ts        POST {url}/{partner}, envelope handling, launch URL builder
│   ├── ProviderService.ts         1070
│   ├── GameService.ts             1071
│   ├── TokenService.ts            1050 + unique QA identities
│   └── Md5Provider.ts             isolated md5 strategy
├── qa/
│   ├── QaRunner.ts                run lifecycle, queue, events (QaRun / QaRunner)
│   ├── WorkerPool.ts              bounded concurrency, stop()
│   ├── GameTester.ts              one game × currency: session → HTTP → browser → currency → limits → evidence
│   ├── TestContext.ts             run-scoped services
│   ├── TestResult.ts              computeOverall() — the only place verdicts are decided
│   ├── QaConfig.ts                validation of the UI configuration
│   ├── CatalogService.ts          "Load games"
│   ├── EvidenceWriter.ts          screenshots / diagnostics folder
│   ├── launch/                    LaunchChainFollower, HtmlInspector, CookieJar (Level 1)
│   ├── tests/                     LaunchTest (HTTP + browser evaluators), CurrencyTest, LimitsTest
│   └── detectors/
│       ├── SemanticErrorDetector.ts
│       ├── LimitDetector.ts, CurrencyDetector.ts, GameBrowserContext.ts, DetectorRegistry.ts
│       ├── generic/               Network/Input/Dom/Accessibility/Text limit detectors, Network/Text currency detectors
│       └── providers/             provider-specific detectors (none yet)
├── browser/                       BrowserManager (1 Chromium, N contexts), GameBrowser (Level 2), GameSnapshot
├── reporting/                     ExcelReporter, ReportFormatter, ReportService
├── api/QaController.ts            HTTP handlers + Server-Sent Events
├── web/routes, web/public         Express routes, Bootstrap 5 + Select2 UI (served from node_modules, no CDN)
├── cli/integration.ts             manual integration mode
├── dev/mockAggregator.ts          fake aggregator for demos and e2e tests
└── server.ts
```

Detectors never drive the browser: `GameBrowser` produces a `GameSnapshot` (pure data) once, and every
detector reads it. That keeps detectors fast, independent and unit-testable.

Live progress uses **Server-Sent Events** (`GET /api/events`: `snapshot`, `state`, `progress`, `result`, `log`).

## 15. Adding a new generic detector

1. Create `src/qa/detectors/generic/MyLimitDetector.ts` implementing `LimitDetector`
   (or `CurrencyDetector`):

   ```ts
   export class MyLimitDetector implements LimitDetector {
     readonly name = 'my-detector';
     async detect(ctx: GameBrowserContext): Promise<LimitDetectionResult> {
       const result: LimitDetectionResult = { detector: this.name };
       // read ctx.snapshot.frames / ctx.snapshot.responses
       // result.min = { value: 0.1, confidence: 'high', evidence: 'where it was found' };
       return result;
     }
   }
   ```
2. Add it to the generic list in `DetectorRegistry` at the right priority.
3. Add a unit test with a hand-made snapshot (`tests/helpers/snapshot.ts`).

If the detector needs data that is not in the snapshot yet, extend `FRAME_COLLECTOR_SOURCE`
(`src/browser/frameCollector.ts`, plain JS evaluated in each frame) or the response capture in `GameBrowser`.

## 16. Adding a provider-specific detector

1. Look at the evidence of real games of that provider (`diagnostics/*.json`: frames, bet elements, JSON response URLs).
2. Create `src/qa/detectors/providers/<provider>/<Provider>LimitDetector.ts` implementing `LimitDetector`.
3. Register it in `createDefaultDetectorRegistry()`:

   ```ts
   registry.registerLimitDetector('evolution', new EvolutionLimitDetector());
   ```

   The key is the `provider` code from `1071`. Provider detectors run before the generic ones, so they win.
4. Add a unit test. See `src/qa/detectors/providers/README.md`.

## 17. Adding a new QA check

1. Add a `CheckResult` field to `GameQaResult` (`src/types/QaResult.ts`).
2. Implement the check in `src/qa/tests/` as a class that takes the `GameBrowserContext` (or HTTP data) and
   returns `{ check, errors }`.
3. Call it from `GameTester.run()` and store its evidence in `buildDiagnostics()`.
4. Include the field in `computeOverall()` so it affects the verdict.
5. Add a column in `ExcelReporter.resultsSheet()` and in the UI table (`src/web/public/app.js`).
6. Unit-test it.

## 18. Tests

```bash
npm test             # unit tests (mocked HTTP, no network, no browser)
npm run test:e2e     # mock aggregator + real Chromium: 4182 PASS, 4170 FAIL, blank REVIEW, limits, stop
npm run typecheck
npm run build
```

Unit tests cover request construction, 1070/1071/1050 parsing, launch URLs, the launch chain (including the
4170 and 4182 cases), semantic errors, currency comparison and detection, limit parsing/detection/comparison,
the worker pool, result aggregation, redaction, configuration validation and Excel generation.

### Manual integration test (authorized partner only)

```bash
QA_AGGREGATOR_URL=https://integration.playgg.uno QA_PARTNER_CODE=alpha-test QA_API_KEY=... \
  npm run integration -- --games 4182,4170 --currencies GBP,EUR --min 0.10 --max 100
```

Options: `--games`, `--currencies`, `--lang`, `--workers`, `--min`, `--default`, `--max`, `--max-games`,
`--no-browser`. Prints one line per result and writes the Excel report into `reports/`.
