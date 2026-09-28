const MASK = '***';

/** Query-string / JSON keys whose values are always treated as secrets. */
const SENSITIVE_KEY =
  /^(api[-_]?key|authorization|auth|token|access[-_]?token|refresh[-_]?token|session[-_]?token|sessiontoken|session[-_]?id|sessionid|sid|jsessionid|md5|hash|signature|sig|secret|password|pass|pwd|ticket|launch[-_]?token|player[-_]?token|key|jwt|cookie|set-cookie|x-api-key)$/i;

/** Long opaque path segments (tokens embedded in provider URLs). */
const OPAQUE_SEGMENT = /^[A-Za-z0-9_\-.~%=]{24,}$/;

/**
 * Removes secrets from strings, URLs and objects before they are logged, stored or exported.
 * Secrets registered explicitly (API key, generated tokens, md5 values) are always masked;
 * additionally common credential-bearing keys and opaque URL segments are masked heuristically.
 */
export class Redactor {
  private readonly secrets = new Set<string>();

  register(secret: string | undefined | null): void {
    if (secret && secret.length >= 4) this.secrets.add(secret);
  }

  forget(secret: string | undefined | null): void {
    if (secret) this.secrets.delete(secret);
  }

  clear(): void {
    this.secrets.clear();
  }

  isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY.test(key);
  }

  /** Masks registered secrets and any URL found inside a free-form string. */
  text(input: string): string {
    let out = input;
    // longest first so that a secret containing another secret is fully masked
    const sorted = [...this.secrets].sort((a, b) => b.length - a.length);
    for (const secret of sorted) out = out.split(secret).join(MASK);
    out = out.replace(/https?:\/\/[^\s"'<>`]+/g, (m) => this.url(m));
    out = out.replace(/\b(api[-_]?key|authorization|token|md5)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi, (_m, k: string, sep: string) => `${k}${sep}${MASK}`);
    return out;
  }

  url(input: string): string {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      return this.plain(input);
    }
    if (parsed.username || parsed.password) {
      parsed.username = MASK;
      parsed.password = '';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, MASK);
    }
    const segments = parsed.pathname.split('/').map((segment) => {
      if (this.containsSecret(decodeSafe(segment))) return MASK;
      return OPAQUE_SEGMENT.test(segment) ? MASK : segment;
    });
    parsed.pathname = segments.join('/');
    if (parsed.hash.length > 24) parsed.hash = MASK;
    let out = parsed.toString();
    out = out.replaceAll(encodeURIComponent(MASK), MASK);
    return this.plain(out);
  }

  /** Deep-copies a JSON-like value with sensitive keys and embedded secrets masked. */
  value<T>(input: T, depth = 0): T {
    if (depth > 12) return '[depth-limit]' as unknown as T;
    if (typeof input === 'string') return this.text(input) as unknown as T;
    if (Array.isArray(input)) return input.map((item) => this.value(item, depth + 1)) as unknown as T;
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        out[key] = SENSITIVE_KEY.test(key) && val !== null && typeof val !== 'object' ? MASK : this.value(val, depth + 1);
      }
      return out as T;
    }
    return input;
  }

  private plain(input: string): string {
    let out = input;
    for (const secret of this.secrets) out = out.split(secret).join(MASK);
    return out;
  }

  private containsSecret(value: string): boolean {
    for (const secret of this.secrets) if (value.includes(secret)) return true;
    return false;
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Process-wide redactor used by the logger. Runs register their secrets here. */
export const globalRedactor = new Redactor();
