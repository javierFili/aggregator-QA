import { normalizeCurrencies } from '../types/Currency.js';
import { parseAmount } from '../util/amount.js';
import { validateBaseUrl, validatePartnerCode } from '../util/url.js';
import { parseExistingPlayers, type ExistingPlayer } from '../aggregator/TokenService.js';

export interface ExpectedLimits {
  min?: number;
  default?: number;
  max?: number;
}

export interface QaOptions {
  testCurrencies: boolean;
  testLimits: boolean;
  /** Level 2: open games in Chromium. Required for currency runtime detection and limits. */
  browserCheck: boolean;
  screenshotsOnFailure: boolean;
  screenshotsAll: boolean;
  testUndeclaredCurrencies: boolean;
  /** Extra wait after the first render until the game has finished loading (0 = do not wait). */
  readyTimeoutMs: number;
}

export interface QaFilters {
  providers: string[];
  gameIds: number[];
  /** Test at most N games (0 = all). */
  maxGames: number;
}

export interface Credentials {
  aggregatorUrl: string;
  launcherUrl?: string;
  partnerCode: string;
  apiKey: string;
}

export interface QaRunConfig extends Credentials {
  /** How QA players (one per currency) are named and how their md5 is computed for opType 1050. */
  players: { prefix?: string; existing?: Record<string, ExistingPlayer> };
  /**
   * Optional header sent only to the aggregator's own domain(s), so a Cloudflare/WAF rule can let the QA tool through
   * (e.g. `X-QA-Runner: <secret>`). Never sent to game providers.
   */
  accessHeader?: { name: string; value: string };
  currencies: string[];
  lang: string;
  workers: number;
  expectedLimits: ExpectedLimits;
  options: QaOptions;
  filters: QaFilters;
}

export class ConfigValidationError extends Error {}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'on' || value === '1') return true;
  if (value === 'false' || value === 'off' || value === '0') return false;
  return fallback;
}

function optionalAmount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseAmount(value as string | number);
  if (parsed === undefined || parsed < 0) throw new ConfigValidationError(`${field} no es un importe válido.`);
  return parsed;
}

/** UI sends seconds; 0 disables the extra wait; capped at 180 s. */
function readyTimeout(value: unknown, fallbackMs: number): number {
  if (value === undefined || value === null || value === '') return fallbackMs;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) throw new ConfigValidationError('La espera máxima de carga debe ser un número de segundos.');
  return Math.min(180, seconds) * 1000;
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,;\s]+/).filter(Boolean);
  return [];
}

/**
 * Accepts the integration endpoint exactly as the docs show it: `https://integration.playgg.uno/alpha-test`.
 * The last path segment is the partner code unless a partner code is given explicitly.
 */
export function splitEndpoint(endpoint: string, partnerCode: string): { baseUrl: string; partnerCode: string } {
  const url = validateBaseUrl(endpoint, 'El endpoint de integración');
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (partnerCode) {
    // "Endpoint: https://host/sping2" + "Partner Code: sping2" → don't repeat the partner in the URL
    if (segments[segments.length - 1] === partnerCode) {
      segments.pop();
      parsed.pathname = segments.join('/');
      return { baseUrl: parsed.toString().replace(/\/+$/, ''), partnerCode };
    }
    return { baseUrl: url, partnerCode };
  }
  const last = segments.pop();
  if (!last) throw new ConfigValidationError('Falta el código de partner: escribe el endpoint completo, p. ej. https://integration.playgg.uno/alpha-test');
  parsed.pathname = segments.join('/');
  return { baseUrl: parsed.toString().replace(/\/+$/, ''), partnerCode: decodeURIComponent(last) };
}

export function parseCredentials(body: Record<string, unknown>): Credentials {
  try {
    const { baseUrl, partnerCode } = splitEndpoint(str(body.aggregatorUrl), str(body.partnerCode));
    const credentials: Credentials = {
      aggregatorUrl: baseUrl,
      partnerCode: validatePartnerCode(partnerCode),
      apiKey: str(body.apiKey),
    };
    const launcher = str(body.launcherUrl);
    if (launcher) credentials.launcherUrl = validateBaseUrl(launcher, 'La URL del launcher');
    if (!credentials.apiKey) throw new ConfigValidationError('La API Key es obligatoria.');
    return credentials;
  } catch (err) {
    throw err instanceof ConfigValidationError ? err : new ConfigValidationError((err as Error).message);
  }
}

/** Validates and normalises the configuration posted by the UI. */
export function parseRunConfig(body: Record<string, unknown>, limits: { defaultWorkers: number; maxWorkers: number; defaultReadyTimeoutMs?: number }): QaRunConfig {
  const credentials = parseCredentials(body);
  const lang = str(body.lang) || 'en';
  if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(lang)) throw new ConfigValidationError('Idioma inválido.');
  const workersRaw = Number.parseInt(String(body.workers ?? limits.defaultWorkers), 10);
  const workers = Math.min(limits.maxWorkers, Math.max(1, Number.isFinite(workersRaw) ? workersRaw : limits.defaultWorkers));
  const rawOptions = (body.options ?? {}) as Record<string, unknown>;
  const rawLimits = (body.expectedLimits ?? {}) as Record<string, unknown>;
  const rawFilters = (body.filters ?? {}) as Record<string, unknown>;

  const expectedLimits: ExpectedLimits = {};
  const min = optionalAmount(rawLimits.min, 'La apuesta mínima');
  const def = optionalAmount(rawLimits.default, 'La apuesta por defecto');
  const max = optionalAmount(rawLimits.max, 'La apuesta máxima');
  if (min !== undefined) expectedLimits.min = min;
  if (def !== undefined) expectedLimits.default = def;
  if (max !== undefined) expectedLimits.max = max;
  if (min !== undefined && max !== undefined && min > max) throw new ConfigValidationError('La apuesta mínima no puede ser mayor que la máxima.');

  const gameIds = list(rawFilters.gameIds)
    .map((v) => Number.parseInt(String(v), 10))
    .filter((n) => Number.isSafeInteger(n) && n >= 0);

  const rawPlayers = (body.players ?? {}) as Record<string, unknown>;
  const prefix = str(rawPlayers.prefix);
  if (prefix && !/^[A-Za-z0-9._-]{1,40}$/.test(prefix)) throw new ConfigValidationError('Prefijo de jugador: solo letras, números, ".", "_" y "-" (máx. 40).');
  const players: QaRunConfig['players'] = {};
  if (prefix) players.prefix = prefix;
  if (typeof rawPlayers.existing === 'string' && rawPlayers.existing.trim()) {
    try {
      players.existing = parseExistingPlayers(rawPlayers.existing);
    } catch (err) {
      throw new ConfigValidationError((err as Error).message);
    }
  }

  const rawHeader = (body.accessHeader ?? {}) as Record<string, unknown>;
  const headerName = str(rawHeader.name);
  const headerValue = typeof rawHeader.value === 'string' ? rawHeader.value.trim() : '';
  let accessHeader: QaRunConfig['accessHeader'];
  if (headerName || headerValue) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(headerName) || !headerValue) {
      throw new ConfigValidationError('Cabecera de acceso: pon un nombre (letras, números y "-") y un valor, o deja los dos vacíos.');
    }
    if (/^(host|cookie|content-length|api-key|authorization)$/i.test(headerName)) throw new ConfigValidationError(`Cabecera de acceso: «${headerName}» no está permitida.`);
    accessHeader = { name: headerName, value: headerValue };
  }

  return {
    ...credentials,
    players,
    ...(accessHeader ? { accessHeader } : {}),
    currencies: normalizeCurrencies(list(body.currencies)),
    lang: lang.toLowerCase(),
    workers,
    expectedLimits,
    options: {
      testCurrencies: bool(rawOptions.testCurrencies, true),
      testLimits: bool(rawOptions.testLimits, true),
      browserCheck: bool(rawOptions.browserCheck, true),
      screenshotsOnFailure: bool(rawOptions.screenshotsOnFailure, true),
      screenshotsAll: bool(rawOptions.screenshotsAll, false),
      testUndeclaredCurrencies: bool(rawOptions.testUndeclaredCurrencies, false),
      readyTimeoutMs: readyTimeout(rawOptions.readyTimeout, limits.defaultReadyTimeoutMs ?? 30_000),
    },
    filters: {
      providers: list(rawFilters.providers).map((p) => String(p).trim()).filter(Boolean),
      gameIds: [...new Set(gameIds)],
      maxGames: Math.max(0, Number.parseInt(String(rawFilters.maxGames ?? 0), 10) || 0),
    },
  };
}
