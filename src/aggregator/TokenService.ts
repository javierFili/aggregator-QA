import { Redactor, globalRedactor } from '../util/Redactor.js';
import type { AggregatorClient } from './AggregatorClient.js';

export const OP_CREATE_TOKEN = 1050;
export const OP_USER_REGISTER = 1053;

export interface PlayerCredentials {
  username: string;
  userId: string;
  /** Value sent as `md5` in 1050 (= md5 of the player's password). */
  md5: string;
}

export interface ExistingPlayer extends PlayerCredentials {}

/** Extracts the launch token from a 1050 response (documented as a plain string). */
export function parseTokenResponse(message: unknown): string {
  if (typeof message === 'string' && /^[A-Za-z0-9._~\-]{8,}$/.test(message.trim())) return message.trim();
  if (message && typeof message === 'object') {
    const m = message as Record<string, unknown>;
    for (const key of ['token', 'launchToken', 'launch_token', 'session', 'sessionToken']) {
      const v = m[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

export const DEFAULT_PLAYER_PREFIX = 'qa-runner';

/**
 * Naming of automatic QA players: `<prefix>-<currency>-w<worker>`, e.g. `qa-runner-eur-w01`.
 * The default prefix is fixed so the same players are reused run after run (their password is deterministic).
 */
export class QaIdentityGenerator {
  readonly runPrefix: string;

  constructor(_date = new Date(), prefix?: string) {
    const clean = prefix?.trim().replace(/[^A-Za-z0-9._-]/g, '');
    this.runPrefix = clean || DEFAULT_PLAYER_PREFIX;
  }

  usernameFor(currency: string, workerId: number): string {
    return `${this.runPrefix}-${currency.toLowerCase()}-w${String(workerId).padStart(2, '0')}`;
  }
}

/**
 * Parses lines `CURRENCY;username;user_id;md5` (also `,` or tabs). user_id may be empty (= username).
 * Throws with the line number on malformed input.
 */
export function parseExistingPlayers(text: string): Record<string, ExistingPlayer> {
  const out: Record<string, ExistingPlayer> = {};
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/[;,\t]/).map((p) => p.trim());
    const [currency = '', username = '', userId = '', md5 = ''] = parts.length === 3 ? [parts[0], parts[1], '', parts[2]] : parts;
    if (!/^[A-Za-z]{3}$/.test(currency) || !username || !md5) {
      throw new Error(`Jugadores existentes, línea ${i + 1}: usa el formato DIVISA;username;user_id;md5`);
    }
    out[currency.toUpperCase()] = { username, userId: userId || username, md5 };
  });
  return out;
}

export interface RegisterResult {
  created: boolean;
  /** Currency the aggregator assigned to the player, when it tells us. */
  currency?: string;
}

/** Low-level player operations of the partner API: 1050 (login / create token) and 1053 (register). */
export class TokenService {
  constructor(
    private readonly client: AggregatorClient,
    private readonly redactor: Redactor = globalRedactor,
  ) {}

  buildLoginRequest(player: PlayerCredentials, currency: string, lang: string): Record<string, unknown> & { opType: number } {
    // As documented: no `token` is sent, so the aggregator issues a new unique one for every launch.
    return { opType: OP_CREATE_TOKEN, username: player.username, user_id: player.userId, md5: player.md5, currency, lang };
  }

  async login(player: PlayerCredentials, currency: string, lang: string): Promise<string> {
    this.redactor.register(player.md5);
    const message = await this.client.call<unknown>(this.buildLoginRequest(player, currency, lang));
    const token = parseTokenResponse(message);
    if (!token) throw new Error('opType 1050: la respuesta no contiene un token');
    this.redactor.register(token);
    return token;
  }

  buildRegisterRequest(username: string, password: string, currency: string): Record<string, unknown> & { opType: number } {
    return {
      opType: OP_USER_REGISTER,
      username,
      user_id: username,
      email: `${username}@qa-runner.test`,
      password,
      currency,
      extra_params: { source: 'qa-runner' },
    };
  }

  /** Registers a player (1053). "Already registered" is not an error: the player simply exists. */
  async register(username: string, password: string, currency: string): Promise<RegisterResult> {
    this.redactor.register(password);
    try {
      const message = await this.client.call<unknown>(this.buildRegisterRequest(username, password, currency));
      const code = (message as { currency?: { code?: unknown } } | null)?.currency?.code;
      return typeof code === 'string' ? { created: true, currency: code.toUpperCase() } : { created: true };
    } catch (err) {
      if (/already registered|ya registrad/i.test((err as Error).message)) return { created: false };
      throw err;
    }
  }
}
