import express from 'express';
import { env } from './config/environment.js';
import { QaController } from './api/QaController.js';
import { BrowserManager } from './browser/BrowserManager.js';
import { CatalogService } from './qa/CatalogService.js';
import { QaRunner } from './qa/QaRunner.js';
import { ReportService } from './reporting/ReportService.js';
import { logger } from './util/logger.js';
import { apiRoutes, localOnly, webRoutes } from './web/routes/index.js';
import { FakeWallet, parseBalances } from './wallet/FakeWallet.js';

const browserManager = new BrowserManager({ headless: env.playwrightHeadless });
const runner = new QaRunner({
  browserManager,
  reportsDir: env.reportsDir,
  requestTimeoutMs: env.requestTimeoutMs,
  browserTimeoutMs: env.browserTimeoutMs,
  settleTimeoutMs: env.gameSettleTimeoutMs,
});
const controller = new QaController(env, new CatalogService({ timeoutMs: env.requestTimeoutMs }), runner, new ReportService());

const app = express();
app.disable('x-powered-by');

// Fake seamless wallet: the aggregator calls it from outside (through a tunnel), so it is mounted BEFORE the
// localhost guard. It only answers wallet operations with fictitious balances.
const wallet = new FakeWallet({
  defaultBalance: env.fakeWallet.defaultBalance,
  balances: parseBalances(env.fakeWallet.balances),
  ...(env.fakeWallet.apiKey ? { apiKey: env.fakeWallet.apiKey } : {}),
});
if (env.fakeWallet.enabled) app.use('/wallet', wallet.router());

const loopback = ['127.0.0.1', 'localhost', '[::1]'];
const hosts = [...new Set([...loopback, env.host])].map((h) => `${h}:${env.port}`);
app.use(localOnly(hosts));
app.get('/api/wallet', (_req, res) => {
  res.json({ enabled: env.fakeWallet.enabled, path: '/wallet', defaultBalance: env.fakeWallet.defaultBalance, balances: parseBalances(env.fakeWallet.balances), stats: wallet.stats });
});
app.use('/api', apiRoutes(controller));
app.use(webRoutes(env.rootDir));

const server = app.listen(env.port, env.host, () => {
  logger.info(`iGaming QA Runner listening on http://${env.host}:${env.port}`);
  if (env.fakeWallet.enabled) logger.info(`Fake wallet (seamless 2051/2052) on http://${env.host}:${env.port}/wallet · balance ${env.fakeWallet.defaultBalance}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.host)) {
    logger.warn(`HOST=${env.host} exposes the tool beyond this machine. Use 127.0.0.1 unless you really need it.`);
  }
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  runner.stop();
  server.close();
  await Promise.race([runner.run?.wait(), new Promise((r) => setTimeout(r, 10_000))]);
  await browserManager.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
