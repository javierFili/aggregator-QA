import type { FetchLike } from '../../aggregator/AggregatorClient.js';
import { Redactor, globalRedactor } from '../../util/Redactor.js';
import { isHttpUrl } from '../../util/url.js';
import { SemanticErrorDetector, semanticErrorDetector, type SemanticError } from '../detectors/SemanticErrorDetector.js';
import { CookieJar } from './CookieJar.js';
import { isWafChallenge, WAF_DESCRIPTION } from '../detectors/WafDetector.js';
import { findJsonHop, findNextHop, looksLikeApplication, visibleText, type HopKind } from './HtmlInspector.js';

export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const MAX_BODY_BYTES = 512 * 1024;
const EXCERPT_CHARS = 800;

export interface ChainHop {
  index: number;
  /** How this URL was reached from the previous hop. */
  via: HopKind | 'start';
  /** Redacted URL. */
  url: string;
  status?: number;
  contentType?: string;
  durationMs: number;
  /** Redacted, truncated body excerpt (only kept for JSON/text or short HTML). */
  bodyExcerpt?: string;
}

export type ChainOutcome =
  | 'LOADED' // reached an HTML application page with no further hop
  | 'SEMANTIC_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'EMPTY'
  | 'WAF_BLOCKED' // anti-bot interstitial (e.g. Cloudflare) before the game
  | 'UNKNOWN_CONTENT'
  | 'TOO_MANY_HOPS';

export interface ChainResult {
  outcome: ChainOutcome;
  hops: ChainHop[];
  /** Index of the hop that decided the outcome. */
  failedHop?: number;
  semanticError?: SemanticError;
  description: string;
  /** Final URL reached (redacted). */
  finalUrl?: string;
}

export interface LaunchChainFollowerOptions {
  timeoutMs: number;
  maxHops?: number;
  fetchImpl?: FetchLike;
  redactor?: Redactor;
  errorDetector?: SemanticErrorDetector;
  userAgent?: string;
  acceptLanguage?: string;
  /** Extra headers sent ONLY to these hosts (e.g. a Cloudflare allow-rule header for the aggregator's own domain). */
  hostHeaders?: { hosts: readonly string[]; headers: Record<string, string> };
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Level 1 (HTTP) launch test: follows aggregator launch → redirects → iframe → provider launch → game frontend
 * using plain HTTP requests, and flags semantic errors even when every response is HTTP 200.
 */
export class LaunchChainFollower {
  private readonly fetchImpl: FetchLike;
  private readonly redactor: Redactor;
  private readonly detector: SemanticErrorDetector;
  private readonly maxHops: number;

  constructor(private readonly options: LaunchChainFollowerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.redactor = options.redactor ?? globalRedactor;
    this.detector = options.errorDetector ?? semanticErrorDetector;
    this.maxHops = options.maxHops ?? 8;
  }

  async follow(startUrl: string): Promise<ChainResult> {
    const hops: ChainHop[] = [];
    const visited = new Set<string>();
    const jar = new CookieJar();
    let url = startUrl;
    let via: ChainHop['via'] = 'start';
    let referer: string | undefined;

    for (let index = 0; index < this.maxHops; index++) {
      const redactedUrl = this.redactor.url(url);
      const hop: ChainHop = { index, via, url: redactedUrl, durationMs: 0 };
      hops.push(hop);

      if (!isHttpUrl(url)) {
        return this.result('UNKNOWN_CONTENT', hops, index, `URL no soportada en la cadena de lanzamiento: ${redactedUrl}`);
      }
      if (visited.has(url)) {
        return this.result('TOO_MANY_HOPS', hops, index, 'Bucle de redirecciones detectado');
      }
      visited.add(url);

      const started = Date.now();
      let response: Response;
      try {
        const headers: Record<string, string> = {
          'User-Agent': this.options.userAgent ?? DESKTOP_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': this.options.acceptLanguage ?? 'en',
        };
        const cookie = jar.header(url);
        if (cookie) headers.Cookie = cookie;
        if (referer) headers.Referer = referer;
        const own = this.options.hostHeaders;
        if (own && own.hosts.includes(new URL(url).hostname)) Object.assign(headers, own.headers);
        response = await this.fetchImpl(url, { method: 'GET', redirect: 'manual', headers, signal: AbortSignal.timeout(this.options.timeoutMs) });
      } catch (err) {
        hop.durationMs = Date.now() - started;
        const e = err as Error;
        const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        return this.result(
          timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          hops,
          index,
          timeout ? `Tiempo de espera agotado (${this.options.timeoutMs} ms)` : `Error de red: ${this.redactor.text(causeMessage(e))}`,
        );
      }
      jar.store(url, response);
      hop.status = response.status;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType) hop.contentType = contentType;

      // Redirects
      if (response.status >= 300 && response.status < 400) {
        hop.durationMs = Date.now() - started;
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (!location) return this.result('HTTP_ERROR', hops, index, `HTTP ${response.status} sin cabecera Location`);
        referer = url;
        url = new URL(location, url).toString();
        via = 'redirect';
        continue;
      }

      const body = await readLimited(response).catch(() => '');
      hop.durationMs = Date.now() - started;
      const ct = contentType.toLowerCase();
      const trimmed = body.trim();
      const isJson = ct.includes('json') || (!ct.includes('html') && /^[[{]/.test(trimmed));
      const isHtml = ct.includes('html') || (!isJson && /^<(!doctype|html|head|body|iframe|div|script)/i.test(trimmed));

      if (isJson || ct.includes('text/plain') || (!isHtml && trimmed.length < 2000)) {
        hop.bodyExcerpt = this.redactor.text(trimmed.slice(0, EXCERPT_CHARS));
      }

      if (isHtml && isWafChallenge({ html: body.slice(0, 50_000) })) {
        return this.result('WAF_BLOCKED', hops, index, WAF_DESCRIPTION);
      }

      const semantic = isJson || ct.includes('text/plain') ? this.detector.detectBody(body, contentType || 'application/json') : undefined;
      if (semantic) {
        return this.result('SEMANTIC_ERROR', hops, index, `${semantic.description}`, semantic);
      }
      if (response.status >= 400) {
        const textError = isHtml ? this.detector.detectText(visibleText(body).slice(0, 2000)) : undefined;
        return this.result('HTTP_ERROR', hops, index, `HTTP ${response.status}${textError ? `: ${textError.description}` : ''}`, textError);
      }

      if (isJson) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return this.result('UNKNOWN_CONTENT', hops, index, 'JSON inválido en la respuesta');
        }
        const next = findJsonHop(parsed);
        if (!next) return this.result('UNKNOWN_CONTENT', hops, index, 'Respuesta JSON sin URL de juego');
        referer = url;
        url = new URL(next.url, url).toString();
        via = next.kind;
        continue;
      }

      if (isHtml) {
        const text = visibleText(body);
        const next = findNextHop(body);
        if (!next) {
          // leaf page: either the game frontend or an error page
          const textError = text.length < 2000 ? this.detector.detectText(text) : undefined;
          if (textError) {
            hop.bodyExcerpt = this.redactor.text(text.slice(0, EXCERPT_CHARS));
            return this.result('SEMANTIC_ERROR', hops, index, textError.description, textError);
          }
          if (!looksLikeApplication(body)) {
            hop.bodyExcerpt = this.redactor.text(trimmed.slice(0, EXCERPT_CHARS));
            return this.result('EMPTY', hops, index, 'La página final está vacía o no contiene una aplicación');
          }
          return this.result('LOADED', hops, index, `Frontend alcanzado tras ${hops.length} salto(s)`);
        }
        // Wrapper page with an error message and an iframe is still an error
        const wrapperError = text.length > 0 && text.length < 500 ? this.detector.detectText(text) : undefined;
        if (wrapperError && wrapperError.category !== 'GENERIC') {
          return this.result('SEMANTIC_ERROR', hops, index, wrapperError.description, wrapperError);
        }
        referer = url;
        url = new URL(next.url, url).toString();
        via = next.kind;
        continue;
      }

      if (!trimmed) return this.result('EMPTY', hops, index, 'Respuesta vacía');
      // binary / unknown content types (e.g. a direct asset) — treat as loaded only if it is not tiny
      return this.result(trimmed.length > 200 ? 'LOADED' : 'UNKNOWN_CONTENT', hops, index, `Tipo de contenido no reconocido: ${contentType || 'desconocido'}`);
    }
    return this.result('TOO_MANY_HOPS', hops, hops.length - 1, `Más de ${this.maxHops} saltos en la cadena de lanzamiento`);
  }

  private result(outcome: ChainOutcome, hops: ChainHop[], failedHop: number, description: string, semanticError?: SemanticError): ChainResult {
    const result: ChainResult = { outcome, hops, failedHop, description };
    if (semanticError) result.semanticError = semanticError;
    const last = hops[hops.length - 1];
    if (last) result.finalUrl = last.url;
    return result;
  }
}

function causeMessage(err: Error): string {
  const cause = (err as Error & { cause?: { message?: string; code?: string } }).cause;
  return cause?.code ?? cause?.message ?? err.message;
}
