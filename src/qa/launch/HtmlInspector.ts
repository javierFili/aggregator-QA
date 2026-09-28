export type HopKind = 'redirect' | 'meta-refresh' | 'iframe' | 'gamedata-url' | 'js-location' | 'json-url' | 'form';

export interface NextHop {
  kind: HopKind;
  url: string;
}

const ENTITY: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>', '&#x2F;': '/', '&#47;': '/' };

export function decodeEntities(value: string): string {
  return value.replace(/&(amp|quot|#39|#x27|lt|gt|#x2F|#47);/g, (m) => ENTITY[m] ?? m);
}

function unescapeJs(value: string): string {
  return value.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=');
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  const value = m?.[1] ?? m?.[2] ?? m?.[3];
  return value === undefined ? undefined : decodeEntities(value.trim());
}

function usable(url: string | undefined): url is string {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  return !!u && u !== '#' && !u.startsWith('about:') && !u.startsWith('javascript:') && !u.startsWith('data:');
}

/** Visible text of an HTML document (scripts/styles removed), whitespace-collapsed. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts the `url` of a `GAMEDATA = {...}` style bootstrap object, as used by some provider launchers. */
export function extractGameDataUrl(html: string): string | undefined {
  const block = /\bGAME_?DATA\b\s*[:=]\s*(\{[\s\S]*?\})\s*[;,\n<]/i.exec(html);
  if (!block?.[1]) return undefined;
  const text = block[1];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.url === 'string') return parsed.url;
  } catch {
    /* JS object literal, fall back to regex */
  }
  const m = /["']?(?:url|launchUrl|gameUrl|game_url)["']?\s*:\s*["']([^"']+)["']/i.exec(text);
  return m?.[1] ? unescapeJs(m[1]) : undefined;
}

/**
 * Finds the next URL of a launch chain inside an HTML document, in priority order:
 * meta refresh → GAMEDATA.url → iframe → JS location assignment → auto-submitted form.
 */
export function findNextHop(html: string): NextHop | undefined {
  const meta = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i.exec(html);
  if (meta) {
    const content = attr(meta[0], 'content');
    const m = content ? /url\s*=\s*['"]?([^'"]+)/i.exec(content) : null;
    if (usable(m?.[1])) return { kind: 'meta-refresh', url: m[1].trim() };
  }

  const gameData = extractGameDataUrl(html);
  if (usable(gameData)) return { kind: 'gamedata-url', url: gameData };

  const iframeRe = /<iframe\b[^>]*>/gi;
  for (let m = iframeRe.exec(html); m; m = iframeRe.exec(html)) {
    const src = attr(m[0], 'src') ?? attr(m[0], 'data-src');
    if (usable(src)) return { kind: 'iframe', url: src };
  }

  const loc =
    /(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/i.exec(html) ??
    /location\.(?:replace|assign)\(\s*["'`]([^"'`]+)["'`]\s*\)/i.exec(html);
  if (usable(loc?.[1]) && !loc[1].includes('${')) return { kind: 'js-location', url: unescapeJs(loc[1]) };

  const form = /<form\b[^>]*>/i.exec(html);
  if (form && /\.submit\(\)/.test(html)) {
    const action = attr(form[0], 'action');
    if (usable(action) && (attr(form[0], 'method') ?? 'get').toLowerCase() === 'get') return { kind: 'form', url: action };
  }
  return undefined;
}

/** Launchers sometimes answer with JSON `{ "url": "..." }` instead of HTML. */
export function findJsonHop(value: unknown): NextHop | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of ['url', 'launchUrl', 'launch_url', 'gameUrl', 'game_url', 'redirect', 'redirectUrl', 'link']) {
    const v = obj[key];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return { kind: 'json-url', url: v };
  }
  for (const key of ['data', 'message', 'result']) {
    const nested = findJsonHop(obj[key]);
    if (nested) return nested;
  }
  return undefined;
}

/** Signals that an HTML page is an actual application (game frontend) rather than an empty shell. */
export function looksLikeApplication(html: string): boolean {
  return /<(script|canvas|video|object|embed)\b/i.test(html) || visibleText(html).length > 50;
}
