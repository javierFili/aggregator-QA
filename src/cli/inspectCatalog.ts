/**
 * Shows HOW the aggregator returns the 1071 catalogue (field names and value formats), without secrets.
 * Useful when games are skipped or parsed wrongly.
 *
 *   QA_AGGREGATOR_URL=https://integration.playgg.uno QA_PARTNER_CODE=alpha-test QA_API_KEY=... npm run inspect:catalog
 */
import { env } from '../config/environment.js';
import { AggregatorClient } from '../aggregator/AggregatorClient.js';
import { parseGames } from '../aggregator/GameService.js';

function shape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})${value.length ? ` of ${shape(value[0])}` : ''}`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `object{${Object.keys(value as object).slice(0, 8).join(',')}}`;
  return typeof value;
}

async function main(): Promise<void> {
  const { QA_AGGREGATOR_URL: url, QA_PARTNER_CODE: partner, QA_API_KEY: apiKey } = process.env;
  if (!url || !partner || !apiKey) {
    console.error('Faltan variables: QA_AGGREGATOR_URL, QA_PARTNER_CODE, QA_API_KEY');
    process.exit(2);
  }
  const client = new AggregatorClient({ baseUrl: url, partnerCode: partner, apiKey, timeoutMs: env.requestTimeoutMs });
  const message = await client.call<unknown>({ opType: 1071 });
  const list = Array.isArray(message) ? message : (message as { games?: unknown[] })?.games;
  console.log(`message: ${shape(message)}`);
  if (!Array.isArray(list) || !list.length) return;
  const first = list[0] as Record<string, unknown>;
  console.log('\nCampos del primer juego y su formato:');
  for (const [k, v] of Object.entries(first)) console.log(`  ${k.padEnd(16)} ${shape(v).padEnd(30)} ${k === 'media' ? '' : JSON.stringify(v).slice(0, 120)}`);
  const games = parseGames(message);
  const empty = games.filter((g) => !g.currencies.length).length;
  const counts: Record<string, number> = {};
  for (const g of games) for (const c of g.currencies) counts[c] = (counts[c] ?? 0) + 1;
  console.log(`\nJuegos leídos: ${games.length} · sin divisas: ${empty}`);
  console.log(`Divisas: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}(${n})`).join(' ') || '(ninguna)'}`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
