/**
 * Manual integration mode against an AUTHORIZED test partner.
 *
 *   QA_AGGREGATOR_URL=https://integration.playgg.uno QA_PARTNER_CODE=alpha-test QA_API_KEY=... \
 *     npm run integration -- --games 4182,4170 --currencies GBP,EUR
 *
 * Credentials are read from the environment (or .env) and never printed.
 */
import { env } from '../config/environment.js';
import { BrowserManager } from '../browser/BrowserManager.js';
import { parseRunConfig } from '../qa/QaConfig.js';
import { QaRun } from '../qa/QaRunner.js';
import { ReportService } from '../reporting/ReportService.js';
import { mainError } from '../reporting/ReportFormatter.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const required = ['QA_AGGREGATOR_URL', 'QA_PARTNER_CODE', 'QA_API_KEY'] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(2);
  }
  const config = parseRunConfig(
    {
      aggregatorUrl: process.env.QA_AGGREGATOR_URL,
      launcherUrl: process.env.QA_LAUNCHER_URL,
      partnerCode: process.env.QA_PARTNER_CODE,
      apiKey: process.env.QA_API_KEY,
      currencies: arg('currencies') ?? 'GBP',
      lang: arg('lang') ?? 'en',
      workers: arg('workers') ?? 2,
      expectedLimits: { min: arg('min'), default: arg('default'), max: arg('max') },
      options: { browserCheck: !process.argv.includes('--no-browser') },
      filters: { gameIds: arg('games') ?? '4182,4170', maxGames: arg('max-games') ?? 0 },
    },
    env,
  );
  const browserManager = new BrowserManager({ headless: env.playwrightHeadless });
  const run = new QaRun(config, {
    browserManager,
    reportsDir: env.reportsDir,
    requestTimeoutMs: env.requestTimeoutMs,
    browserTimeoutMs: env.browserTimeoutMs,
    settleTimeoutMs: env.gameSettleTimeoutMs,
  });
  process.on('SIGINT', () => run.stop());
  try {
    await run.start();
    const summary = run.summary();
    console.log('\n=== Results ===');
    for (const r of run.results) {
      console.log(`${r.overall.padEnd(7)} ${String(r.gameId).padEnd(6)} ${r.gameName} [${r.currency}] launch=${r.launch.status} ${mainError(r)}`);
    }
    console.log(`\nPASS ${summary.counters.PASS} · FAIL ${summary.counters.FAIL} · REVIEW ${summary.counters.REVIEW} · SKIPPED ${summary.counters.SKIPPED}`);
    if (summary.error) console.error(`Run error: ${summary.error}`);
    if (run.results.length) console.log(`Report: ${await new ReportService().generate(run)}`);
  } finally {
    await browserManager.close();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
