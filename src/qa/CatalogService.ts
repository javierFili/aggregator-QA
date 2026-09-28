import { AggregatorClient, type FetchLike } from '../aggregator/AggregatorClient.js';
import { GameService } from '../aggregator/GameService.js';
import { ProviderService } from '../aggregator/ProviderService.js';
import type { Game } from '../types/Game.js';
import type { Provider } from '../types/Provider.js';
import type { Credentials } from './QaConfig.js';

export interface CatalogSummary {
  providers: Array<Provider & { games: number }>;
  games: Game[];
  gameCount: number;
  /** Currency code → number of games declaring it. */
  currencies: Record<string, number>;
  /** Games whose 1071 entry lists no currencies (they are still tested). */
  gamesWithoutCurrencies: number;
  loadedAt: string;
}

/** "Load Games" action: calls 1070 + 1071 with the given credentials. Nothing is cached server-side. */
export class CatalogService {
  constructor(private readonly options: { timeoutMs: number; fetchImpl?: FetchLike }) {}

  async load(credentials: Credentials): Promise<CatalogSummary> {
    const clientOptions: ConstructorParameters<typeof AggregatorClient>[0] = {
      baseUrl: credentials.aggregatorUrl,
      partnerCode: credentials.partnerCode,
      apiKey: credentials.apiKey,
      timeoutMs: this.options.timeoutMs,
    };
    if (credentials.launcherUrl) clientOptions.launcherUrl = credentials.launcherUrl;
    if (this.options.fetchImpl) clientOptions.fetchImpl = this.options.fetchImpl;
    const client = new AggregatorClient(clientOptions);
    const [providers, games] = await Promise.all([new ProviderService(client).getProviders(), new GameService(client).getGames()]);
    return summarizeCatalog(providers, games);
  }
}

export function summarizeCatalog(providers: Provider[], games: Game[]): CatalogSummary {
  const perProvider = new Map<string, number>();
  const currencies: Record<string, number> = {};
  for (const game of games) {
    perProvider.set(game.provider.toLowerCase(), (perProvider.get(game.provider.toLowerCase()) ?? 0) + 1);
    for (const c of game.currencies) currencies[c] = (currencies[c] ?? 0) + 1;
  }
  const known = new Set(providers.map((p) => p.code.toLowerCase()));
  const all = providers.map((p) => ({ ...p, games: perProvider.get(p.code.toLowerCase()) ?? 0 }));
  // providers referenced by games but missing from 1070
  for (const [code, count] of perProvider) if (!known.has(code)) all.push({ id: 0, code, name: code, games: count });
  const gamesWithoutCurrencies = games.filter((g) => g.currencies.length === 0).length;
  return { providers: all, games, gameCount: games.length, currencies, gamesWithoutCurrencies, loadedAt: new Date().toISOString() };
}
