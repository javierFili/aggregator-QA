/** Validates a user-supplied base URL (http/https, no embedded credentials) and strips trailing slashes. */
export function validateBaseUrl(input: string, field = 'URL'): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error(`${field} no es una URL válida.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${field} debe usar http o https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${field} no debe contener credenciales.`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${field} no debe contener parámetros de consulta ni fragmentos.`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

/** Partner codes are used as a path segment; keep them to a safe charset. */
export function validatePartnerCode(input: string): string {
  const code = input.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(code)) {
    throw new Error('El código de partner solo puede contener letras, números, ".", "_" y "-".');
  }
  return code;
}

/** Only http(s) URLs are followed by the launch chain follower. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
