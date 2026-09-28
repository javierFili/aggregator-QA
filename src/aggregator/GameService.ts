import { normalizeCurrencies } from '../types/Currency.js';
import type { Game } from '../types/Game.js';
import type { AggregatorClient } from './AggregatorClient.js';

export const OP_GET_GAMES = 1071;

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(/[,;\s]+/).filter(Boolean);
  return [];
}

const CURRENCY_OBJECT_KEYS = ['code', 'currency', 'iso', 'isoCode', 'currencyCode', 'currency_code', 'name', 'id'];

/**
 * Accepts every currency format seen in catalogues:
 * ["EUR","USD"] · "EUR,USD" · [{"code":"EUR"}] · {"EUR":{...},"USD":{...}} · {"EUR":true}
 */
export function parseCurrencyList(value: unknown): string[] {
  if (typeof value === 'string') return normalizeCurrencies(value.split(/[,;|\s]+/));
  if (Array.isArray(value)) {
    const codes: unknown[] = [];
    for (const item of value) {
      if (typeof item === 'string') codes.push(item);
      else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const key = CURRENCY_OBJECT_KEYS.find((k) => typeof obj[k] === 'string' && /^[A-Za-z]{3}$/.test((obj[k] as string).trim()));
        if (key) codes.push(obj[key]);
      }
    }
    return normalizeCurrencies(codes);
  }
  if (value && typeof value === 'object') {
    // map keyed by currency code; skip entries explicitly disabled
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== false && v !== 0 && v !== null);
    return normalizeCurrencies(entries.map(([k]) => k));
  }
  return [];
}

export function parseGames(message: unknown): Game[] {
  const list = Array.isArray(message)
    ? message
    : message && typeof message === 'object' && Array.isArray((message as { games?: unknown }).games)
      ? (message as { games: unknown[] }).games
      : null;
  if (!list) throw new Error('Respuesta 1071 inválida: se esperaba una lista de juegos');

  const seen = new Set<number>();
  const games: Game[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isSafeInteger(id) || seen.has(id)) continue;
    seen.add(id);
    const game: Game = {
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `#${id}`,
      provider: typeof r.provider === 'string' ? r.provider.trim() : String(r.provider ?? ''),
      device: toStringList(r.device).map((d) => d.toLowerCase()),
      currencies: parseCurrencyList(r.currencies ?? r.currency ?? r.currencyList ?? r.currency_list),
    };
    if (typeof r.media === 'string') game.media = r.media;
    games.push(game);
  }
  return games;
}

export class GameService {
  constructor(private readonly client: AggregatorClient) {}

  /** `currency` (optional, documented) restricts the list to the games available in that currency. */
  async getGames(currency?: string): Promise<Game[]> {
    return parseGames(await this.client.call<unknown>(currency ? { opType: OP_GET_GAMES, currency } : { opType: OP_GET_GAMES }));
  }
}
