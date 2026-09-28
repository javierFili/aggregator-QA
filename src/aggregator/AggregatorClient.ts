import { TimeoutError } from '../util/time.js';
import { Redactor, globalRedactor } from '../util/Redactor.js';
import { validateBaseUrl, validatePartnerCode } from '../util/url.js';

export type FetchLike = typeof fetch;

export interface AggregatorClientOptions {
  /** Base URL of the aggregator partner API, e.g. https://integration.playgg.uno */
  baseUrl: string;
  partnerCode: string;
  apiKey: string;
  /** Base URL used to build launch URLs. Defaults to baseUrl. */
  launcherUrl?: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  redactor?: Redactor;
}

export interface AggregatorEnvelope<T> {
  status: boolean;
  message: T;
}

export class AggregatorError extends Error {
  constructor(
    message: string,
    readonly opType: number,
    readonly kind: 'API_ERROR' | 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'NETWORK_ERROR' | 'TIMEOUT',
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AggregatorError';
  }
}

export interface LaunchUrlOptions {
  lang?: string;
}

/**
 * Thin JSON client for the aggregator partner endpoint: `POST {baseUrl}/{partnerCode}` with an `Api-Key` header.
 * The API key only lives in this instance and is registered with the redactor so it never reaches logs.
 */
export class AggregatorClient {
  readonly baseUrl: string;
  readonly launcherUrl: string;
  readonly partnerCode: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: AggregatorClientOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl, 'La URL del agregador');
    this.launcherUrl = options.launcherUrl ? validateBaseUrl(options.launcherUrl, 'La URL del launcher') : this.baseUrl;
    this.partnerCode = validatePartnerCode(options.partnerCode);
    if (!options.apiKey || !options.apiKey.trim()) throw new Error('La API Key es obligatoria.');
    this.apiKey = options.apiKey.trim();
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    (options.redactor ?? globalRedactor).register(this.apiKey);
  }

  get endpoint(): string {
    return `${this.baseUrl}/${encodeURIComponent(this.partnerCode)}`;
  }

  /** Builds the request that would be sent for an operation (exposed for testing). */
  buildRequest(body: Record<string, unknown>): { url: string; init: RequestInit } {
    return {
      url: this.endpoint,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
          'Api-Key': this.apiKey,
        },
        body: JSON.stringify(body),
      },
    };
  }

  /** Sends an operation and returns the `message` of a successful envelope. Throws AggregatorError otherwise. */
  async call<T>(body: { opType: number } & Record<string, unknown>): Promise<T> {
    const { url, init } = this.buildRequest(body);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError' || err instanceof TimeoutError) {
        throw new AggregatorError(`opType ${body.opType}: tiempo de espera agotado (${this.timeoutMs} ms)`, body.opType, 'TIMEOUT');
      }
      throw new AggregatorError(`opType ${body.opType}: error de red (${e.message})`, body.opType, 'NETWORK_ERROR');
    }

    const text = await response.text();
    let envelope: unknown;
    try {
      envelope = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new AggregatorError(`opType ${body.opType}: HTTP ${response.status}`, body.opType, 'HTTP_ERROR', response.status);
      }
      throw new AggregatorError(`opType ${body.opType}: la respuesta no es JSON`, body.opType, 'INVALID_RESPONSE', response.status);
    }

    if (!envelope || typeof envelope !== 'object' || typeof (envelope as { status?: unknown }).status !== 'boolean') {
      if (!response.ok) {
        throw new AggregatorError(`opType ${body.opType}: HTTP ${response.status}`, body.opType, 'HTTP_ERROR', response.status);
      }
      throw new AggregatorError(`opType ${body.opType}: respuesta sin campo "status"`, body.opType, 'INVALID_RESPONSE', response.status);
    }

    const { status, message } = envelope as AggregatorEnvelope<unknown>;
    if (!status) {
      const description = typeof message === 'string' ? message : JSON.stringify(message);
      throw new AggregatorError(`opType ${body.opType}: ${description}`, body.opType, 'API_ERROR', response.status);
    }
    if (!response.ok) {
      throw new AggregatorError(`opType ${body.opType}: HTTP ${response.status}`, body.opType, 'HTTP_ERROR', response.status);
    }
    return message as T;
  }

  /** `{LAUNCHER_URL}/{partner_code}/launch/{game_id}/{token}?lang=xx` */
  buildLaunchUrl(gameId: number, token: string, options: LaunchUrlOptions = {}): string {
    if (!Number.isSafeInteger(gameId) || gameId < 0) throw new Error(`ID de juego inválido: ${gameId}`);
    if (!token) throw new Error('Token vacío');
    const url = new URL(
      `${this.launcherUrl}/${encodeURIComponent(this.partnerCode)}/launch/${encodeURIComponent(String(gameId))}/${encodeURIComponent(token)}`,
    );
    if (options.lang) url.searchParams.set('lang', options.lang);
    return url.toString();
  }
}
