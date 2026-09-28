import { AggregatorClient, AggregatorError, type FetchLike } from '../aggregator/AggregatorClient.js';
import { GameService } from '../aggregator/GameService.js';
import { PlayerProvisioner } from '../aggregator/PlayerProvisioner.js';
import { globalRedactor } from '../util/Redactor.js';
import type { QaRunConfig } from './QaConfig.js';

export interface SessionProbeResult {
  ok: boolean;
  currency: string;
  username: string;
  source: 'existing' | 'automatic';
  /** Aggregator answer (token masked) or error. */
  response: string;
  /** Currency assigned by the aggregator at registration, if reported. */
  assignedCurrency?: string;
}

export interface SessionProbeReport {
  results: SessionProbeResult[];
  /** Launcher detected with the first available game (if a game id is known). */
  launchMode?: 'partner' | 'front';
  /** True when opening that game hit Cloudflare's anti-bot check. */
  wafBlocked?: boolean;
}

/** "Probar conexión": registers/logs in the QA player of every selected currency, without running the QA. */
export async function probeSessions(config: QaRunConfig, timeoutMs: number, fetchImpl?: FetchLike, sampleGameId?: number): Promise<SessionProbeReport> {
  const options: ConstructorParameters<typeof AggregatorClient>[0] = { baseUrl: config.aggregatorUrl, partnerCode: config.partnerCode, apiKey: config.apiKey, timeoutMs };
  if (config.launcherUrl) options.launcherUrl = config.launcherUrl;
  if (fetchImpl) options.fetchImpl = fetchImpl;
  const client = new AggregatorClient(options);
  const players = new PlayerProvisioner(client, {
    apiKey: config.apiKey,
    lang: config.lang,
    ...(config.players.prefix ? { prefix: config.players.prefix } : {}),
    ...(config.players.existing ? { existing: config.players.existing } : {}),
  });
  const results: SessionProbeResult[] = [];
  for (const currency of config.currencies.length ? config.currencies : ['EUR']) {
    const player = players.playerFor(currency, 1);
    const base = { currency, username: player.username, source: players.isExisting(currency) ? ('existing' as const) : ('automatic' as const) };
    try {
      const session = await players.createSession(currency, 1);
      const assigned = players.assignedCurrency.get(player.username);
      results.push({ ...base, ok: true, response: `sesión creada · token ${session.token.slice(0, 8)}…`, ...(assigned ? { assignedCurrency: assigned } : {}) });
    } catch (err) {
      const message = err instanceof AggregatorError ? err.message.replace(/^opType \d+: /, '') : (err as Error).message;
      results.push({ ...base, ok: false, response: globalRedactor.text(message) });
    }
  }
  const report: SessionProbeReport = { results };
  const firstOk = results.find((r) => r.ok);
  if (sampleGameId === undefined && firstOk) {
    try {
      sampleGameId = (await new GameService(client).getGames(firstOk.currency))[0]?.id;
    } catch {
      /* no sample game → no launcher detection */
    }
  }
  if (sampleGameId !== undefined && firstOk) {
    try {
      const headers = config.accessHeader ? { [config.accessHeader.name]: config.accessHeader.value } : {};
      report.launchMode = await players.detectLaunchMode(sampleGameId, firstOk.currency, fetchImpl ?? fetch, timeoutMs, headers);
      report.wafBlocked = players.detectionBlockedByWaf;
    } catch {
      /* reported through results */
    }
  }
  return report;
}
