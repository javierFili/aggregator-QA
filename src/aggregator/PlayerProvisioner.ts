import type { AggregatorClient, FetchLike } from './AggregatorClient.js';
import { AggregatorError } from './AggregatorClient.js';
import { derivePassword, PasswordMd5Provider, type Md5Provider } from './Md5Provider.js';
import { QaIdentityGenerator, TokenService, type ExistingPlayer, type PlayerCredentials } from './TokenService.js';
import { Redactor, globalRedactor } from '../util/Redactor.js';
import type { Logger } from '../util/logger.js';
import { isWafChallenge } from '../qa/detectors/WafDetector.js';

/**
 * Where a 1050 token has to be opened:
 * - `partner`: `{launcher}/{partner}/launch/{gid}/{token}` (documented; game sessions, Feedh-style partners)
 * - `front`:   `{aggregator}/front/launcher/{gid}/{token}` (partners with the Local/IntWallet driver: 1050 returns a
 *   *site* session that the front launcher turns into a game session)
 */
export type LaunchMode = 'partner' | 'front';

export interface ProvisionedSession {
  username: string;
  currency: string;
  token: string;
  launchUrl(gameId: number): string;
}

const LOGIN_REJECTED = /username or password incorrect|usuario o contrase/i;
const SITE_SESSION_REJECTED = /requested session does not exist|no longer available|la sesi[oó]n solicitada no existe/i;

export interface PlayerProvisionerOptions {
  apiKey: string;
  lang: string;
  prefix?: string;
  existing?: Readonly<Record<string, ExistingPlayer>>;
  runDate?: Date;
  redactor?: Redactor;
  md5Provider?: Md5Provider;
  log?: Logger;
}

/**
 * Manages the QA players: one automatic player per currency AND per worker (`qa-runner-eur-w01`), so concurrent
 * workers never close each other's sessions (1050 closes the player's previous sessions).
 * Login first; if the aggregator does not know the player (`Username or password incorrect`), register it with 1053
 * and log in again — exactly what the aggregator's LocalBusiness requires.
 */
export class PlayerProvisioner {
  readonly tokens: TokenService;
  private readonly identities: QaIdentityGenerator;
  private readonly redactor: Redactor;
  private readonly md5Provider: Md5Provider;
  private readonly registered = new Map<string, Promise<void>>();
  /** Currency the aggregator reported for each registered player. */
  readonly assignedCurrency = new Map<string, string>();
  launchMode: LaunchMode = 'partner';
  /** True when launcher detection hit an anti-bot wall (the result is then only a guess). */
  detectionBlockedByWaf = false;

  constructor(
    private readonly client: AggregatorClient,
    private readonly options: PlayerProvisionerOptions,
  ) {
    this.redactor = options.redactor ?? globalRedactor;
    this.tokens = new TokenService(client, this.redactor);
    this.identities = new QaIdentityGenerator(options.runDate ?? new Date(), options.prefix);
    this.md5Provider = options.md5Provider ?? new PasswordMd5Provider();
    for (const p of Object.values(options.existing ?? {})) this.redactor.register(p.md5);
  }

  isExisting(currency: string): boolean {
    return !!this.options.existing?.[currency.toUpperCase()];
  }

  /** Credentials used for a currency/worker. Existing players (if configured) win over automatic ones. */
  playerFor(currency: string, workerId: number): PlayerCredentials & { password?: string } {
    const known = this.options.existing?.[currency.toUpperCase()];
    if (known) return { ...known };
    const username = this.identities.usernameFor(currency, workerId);
    const password = derivePassword(this.options.apiKey, username);
    this.redactor.register(password);
    return { username, userId: username, password, md5: this.md5Provider.generate(password) };
  }

  async createSession(currency: string, workerId: number): Promise<ProvisionedSession> {
    const player = this.playerFor(currency, workerId);
    let token: string;
    try {
      token = await this.tokens.login(player, currency, this.options.lang);
    } catch (err) {
      if (!player.password || !(err instanceof AggregatorError) || !LOGIN_REJECTED.test(err.message)) throw err;
      await this.ensureRegistered(player.username, player.password, currency);
      token = await this.tokens.login(player, currency, this.options.lang);
    }
    return { username: player.username, currency, token, launchUrl: (gameId) => this.buildLaunchUrl(gameId, token) };
  }

  buildLaunchUrl(gameId: number, token: string): string {
    if (this.launchMode === 'front') {
      const url = new URL(`${this.client.baseUrl}/front/launcher/${encodeURIComponent(String(gameId))}/${encodeURIComponent(token)}`);
      if (this.options.lang) url.searchParams.set('lang', this.options.lang);
      return url.toString();
    }
    return this.client.buildLaunchUrl(gameId, token, { lang: this.options.lang });
  }

  /**
   * Opens one game with a fresh session through the documented launcher; if the aggregator answers that the session
   * does not exist, the partner works with site sessions and the front launcher is used from then on.
   */
  async detectLaunchMode(gameId: number, currency: string, fetchImpl: FetchLike = fetch, timeoutMs = 30_000, headers: Record<string, string> = {}): Promise<LaunchMode> {
    const session = await this.createSession(currency, 1);
    this.launchMode = 'partner';
    this.detectionBlockedByWaf = false;
    try {
      const response = await fetchImpl(this.buildLaunchUrl(gameId, session.token), { headers, signal: AbortSignal.timeout(timeoutMs) });
      const body = (await response.text()).slice(0, 50_000);
      if (SITE_SESSION_REJECTED.test(body)) this.launchMode = 'front';
      else if (isWafChallenge({ html: body })) this.detectionBlockedByWaf = true;
    } catch (err) {
      this.options.log?.warn(`No se pudo detectar el tipo de launcher: ${this.redactor.text((err as Error).message)}`);
    }
    return this.launchMode;
  }

  private ensureRegistered(username: string, password: string, currency: string): Promise<void> {
    let pending = this.registered.get(username);
    if (!pending) {
      pending = this.tokens.register(username, password, currency).then((result) => {
        if (result.currency) this.assignedCurrency.set(username, result.currency);
        this.options.log?.info(`Jugador ${username} ${result.created ? 'registrado (1053)' : 'ya existía'}${result.currency ? ` · divisa asignada: ${result.currency}` : ''}`);
        if (result.currency && result.currency !== currency.toUpperCase()) {
          this.options.log?.warn(`El agregador asignó ${result.currency} al jugador ${username} aunque se pidió ${currency}: 1053 no permite elegir divisa en este partner`);
        }
      });
      pending.catch(() => this.registered.delete(username));
      this.registered.set(username, pending);
    }
    return pending;
  }
}
