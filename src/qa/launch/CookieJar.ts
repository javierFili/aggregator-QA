/** Minimal per-test cookie jar (host-scoped, name=value only) so launch chains relying on cookies can be followed. */
export class CookieJar {
  private readonly byHost = new Map<string, Map<string, string>>();

  store(url: string, response: Response): void {
    const host = new URL(url).hostname;
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const header of setCookies) {
      const pair = header.split(';', 1)[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const jar = this.byHost.get(host) ?? new Map<string, string>();
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      this.byHost.set(host, jar);
    }
  }

  header(url: string): string | undefined {
    const host = new URL(url).hostname;
    const cookies: string[] = [];
    for (const [cookieHost, jar] of this.byHost) {
      if (host === cookieHost || host.endsWith(`.${cookieHost}`)) {
        for (const [name, value] of jar) cookies.push(`${name}=${value}`);
      }
    }
    return cookies.length ? cookies.join('; ') : undefined;
  }
}
