export type SemanticErrorCategory =
  | 'GAME_NOT_FOUND'
  | 'INVALID_TOKEN'
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'GEO_BLOCKED'
  | 'PROVIDER_UNAVAILABLE'
  | 'GAME_UNAVAILABLE'
  | 'CURRENCY_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'SERVER_ERROR'
  | 'AGGREGATOR_ERROR'
  | 'GENERIC';

export interface SemanticError {
  category: SemanticErrorCategory;
  description: string;
  code?: string | number;
}

/** Multi-language keyword patterns, most specific first. */
const PATTERNS: Array<[SemanticErrorCategory, RegExp]> = [
  ['GAME_NOT_FOUND', /game\s*(was\s*)?not\s*found|unknown\s*game|no\s*such\s*game|invalid\s*game(\s*id)?|juego\s*no\s*(encontrado|existe)|jogo\s*n[ãa]o\s*encontrado|jocul\s*nu\s*a\s*fost\s*g[ăa]sit|spiel\s*nicht\s*gefunden|gioco\s*non\s*trovato|jeu\s*(introuvable|non\s*trouv[ée])/i],
  ['INVALID_TOKEN', /invalid\s*(session\s*)?token|token\s*(is\s*)?(invalid|not\s*valid|not\s*found|missing)|bad\s*token|token\s*(inv[áa]lido|no\s*v[áa]lido)|token\s*invalid[oa]?/i],
  ['SESSION_EXPIRED', /session\s*(has\s*)?(expired|timed?\s*out|not\s*found|invalid)|expired\s*session|token\s*(has\s*)?expired|sesi[óo]n\s*(expirada|caducada|inv[áa]lida)|sess[ãa]o\s*expirada|sesiune\s*expirat[ăa]/i],
  ['GEO_BLOCKED', /not\s*available\s*in\s*your\s*(country|region|jurisdiction)|restricted\s*(country|jurisdiction|region)|geo[-\s]?block|no\s*disponible\s*en\s*tu\s*(pa[ií]s|regi[óo]n)/i],
  ['CURRENCY_ERROR', /(unsupported|invalid|unknown|not\s*supported)\s*currency|currency\s*(is\s*)?(not\s*supported|invalid|unsupported|not\s*allowed)|moneda\s*no\s*(soportada|v[áa]lida|permitida)|divisa\s*no\s*(soportada|v[áa]lida)/i],
  ['UNAUTHORIZED', /\bunauthori[sz]ed\b|not\s*authori[sz]ed|authentication\s*(failed|required|error)|no\s*autorizado|n[ãa]o\s*autorizado/i],
  ['FORBIDDEN', /\bforbidden\b|access\s*denied|permission\s*denied|acceso\s*denegado|prohibido/i],
  ['PROVIDER_UNAVAILABLE', /provider\s*(is\s*)?(unavailable|not\s*available|down|error|disabled)|proveedor\s*no\s*disponible/i],
  ['GAME_UNAVAILABLE', /game\s*(is\s*)?(unavailable|not\s*available|disabled|inactive|closed|under\s*maintenance)|juego\s*no\s*disponible|jogo\s*indispon[ií]vel|under\s*maintenance|en\s*mantenimiento/i],
  ['CONFIGURATION_ERROR', /configuration\s*error|misconfigur|not\s*configured|config(uration)?\s*(is\s*)?(missing|invalid|not\s*found)|error\s*de\s*configuraci[óo]n/i],
  ['SERVER_ERROR', /internal\s*server\s*error|bad\s*gateway|service\s*unavailable|gateway\s*time-?out|\b50[0234]\b\s*(error|internal|bad|service)/i],
  ['AGGREGATOR_ERROR', /\bERR-\d{3,5}\b/],
];

const GENERIC_ERROR_WORDS = /\b(error|failed|failure|exception|fault|invalid|denied|not\s*found)\b|\berror\b|fall[óo]|fallo|erro\b|eroare/i;

export function classifyText(text: string): SemanticErrorCategory | undefined {
  for (const [category, pattern] of PATTERNS) if (pattern.test(text)) return category;
  return undefined;
}

const ERROR_KEYS = ['error', 'errors', 'err', 'error_message', 'errorMessage', 'errorDescription', 'error_description', 'fault'];
const CODE_KEYS = ['errorCode', 'error_code', 'errCode', 'err_code'];
const MESSAGE_KEYS = ['description', 'message', 'msg', 'detail', 'details', 'reason', 'text', 'title'];

function pickMessage(obj: Record<string, unknown>): string | undefined {
  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickCode(obj: Record<string, unknown>): string | number | undefined {
  for (const key of ['code', ...CODE_KEYS]) {
    const v = obj[key];
    if (typeof v === 'number' || (typeof v === 'string' && v.trim())) return v;
  }
  return undefined;
}

function isTruthyError(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '' || value === 0 || value === '0') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length === 0) return false;
    // { "error": { "code": 0, "message": "OK" } } is a success envelope
    const code = obj.code ?? obj.errorCode;
    if (code === 0 || code === '0') {
      const msg = pickMessage(obj);
      return msg ? classifyText(msg) !== undefined : false;
    }
    return true;
  }
  if (typeof value === 'string') return !/^(none|null|ok|success|false|no)$/i.test(value.trim());
  return true;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const msg = pickMessage(value as Record<string, unknown>);
    if (msg) return msg;
    if (Array.isArray(value) && value.length) return describe(value[0]);
  }
  return JSON.stringify(value).slice(0, 300);
}

function build(description: string, code?: string | number): SemanticError {
  const error: SemanticError = { category: classifyText(description) ?? 'GENERIC', description: description.slice(0, 500) };
  if (code !== undefined) error.code = code;
  return error;
}

function detectInObject(obj: Record<string, unknown>, depth: number): SemanticError | undefined {
  // { "error": ... } and friends
  for (const key of ERROR_KEYS) {
    if (key in obj && isTruthyError(obj[key])) {
      const value = obj[key];
      const nested = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
      return build(describe(value), nested ? pickCode(nested) : pickCode(obj));
    }
  }
  // { "errorCode": 12, "message": "..." }
  for (const key of CODE_KEYS) {
    if (key in obj && isTruthyError(obj[key])) {
      return build(pickMessage(obj) ?? `${key}=${String(obj[key])}`, obj[key] as string | number);
    }
  }
  // { "status": false, "message": "ERR-0000: ..." } / { "success": false } / { "status": "error" } / { "result": "fail" }
  for (const key of ['status', 'success', 'ok', 'result']) {
    const v = obj[key];
    if (v === false || (typeof v === 'string' && /^(error|fail(ed|ure)?|ko|denied)$/i.test(v.trim()))) {
      const message = obj.message;
      const text = typeof message === 'string' ? message : message && typeof message === 'object' ? describe(message) : pickMessage(obj);
      return build(text ?? `${key}=${String(v)}`, pickCode(obj));
    }
  }
  // { "code": -1, "description": "Game not found" }
  const code = obj.code;
  const message = pickMessage(obj);
  if (typeof code === 'number' && code < 0 && message) return build(message, code);
  if (message && Object.keys(obj).length <= 4 && classifyText(message)) return build(message, pickCode(obj));

  if (depth < 3) {
    for (const key of ['data', 'response', 'result', 'payload', 'body']) {
      const v = obj[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const found = detectInObject(v as Record<string, unknown>, depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/**
 * Detects "HTTP 200 but actually an error" responses from aggregators and providers,
 * by inspecting JSON structure first and falling back to multi-language keyword matching.
 */
export class SemanticErrorDetector {
  detectJson(value: unknown): SemanticError | undefined {
    if (Array.isArray(value)) return undefined;
    if (!value || typeof value !== 'object') {
      return typeof value === 'string' ? this.detectText(value) : undefined;
    }
    return detectInObject(value as Record<string, unknown>, 0);
  }

  /**
   * Keyword detection for short texts (error pages, JSON rendered in a frame, alerts).
   * Long texts are only matched against the specific patterns, never the generic "error" word,
   * to avoid false positives inside real game UIs.
   */
  detectText(text: string): SemanticError | undefined {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) return undefined;
    if (/^[[{]/.test(trimmed)) {
      try {
        return this.detectJson(JSON.parse(trimmed));
      } catch {
        /* not JSON */
      }
    }
    const category = classifyText(trimmed);
    if (category) return { category, description: excerptAround(trimmed, category) };
    if (trimmed.length <= 200 && GENERIC_ERROR_WORDS.test(trimmed)) return { category: 'GENERIC', description: trimmed };
    return undefined;
  }

  /** Parses a body according to its content type and runs the right detector. */
  detectBody(body: string, contentType: string | null | undefined): SemanticError | undefined {
    const ct = (contentType ?? '').toLowerCase();
    const trimmed = body.trim();
    if (ct.includes('json') || /^[[{]/.test(trimmed)) {
      try {
        return this.detectJson(JSON.parse(trimmed));
      } catch {
        if (ct.includes('json')) return { category: 'GENERIC', description: 'Respuesta JSON inválida' };
      }
    }
    if (ct.includes('text/plain')) return this.detectText(trimmed.slice(0, 5000));
    return undefined;
  }
}

function excerptAround(text: string, category: SemanticErrorCategory): string {
  const pattern = PATTERNS.find(([c]) => c === category)?.[1];
  const match = pattern ? pattern.exec(text) : null;
  if (!match) return text.slice(0, 200);
  const start = Math.max(0, match.index - 60);
  return text.slice(start, match.index + match[0].length + 60).trim();
}

export const semanticErrorDetector = new SemanticErrorDetector();
