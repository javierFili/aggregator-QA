/** Normalises a list of currency codes: trims, upper-cases, keeps only 3-letter codes and removes duplicates. */
export function normalizeCurrencies(values: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) out.add(code);
  }
  return [...out];
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/** Symbols that can be mapped back to a single ISO code with reasonable confidence. */
export const CURRENCY_SYMBOLS: Record<string, string[]> = {
  GBP: ['£'],
  EUR: ['€'],
  USD: ['US$', 'U$S'],
  BRL: ['R$'],
  RON: ['lei'],
  JPY: ['¥'],
  INR: ['₹'],
  TRY: ['₺'],
  PLN: ['zł'],
  UAH: ['₴'],
  KRW: ['₩'],
  NGN: ['₦'],
  PHP: ['₱'],
  BOB: ['Bs.'],
  PEN: ['S/'],
  ZAR: ['R '],
};

/** Common ISO 4217 codes used to recognise currencies in free text without matching random words. */
export const KNOWN_CURRENCIES: readonly string[] = [
  'EUR', 'USD', 'GBP', 'RON', 'BRL', 'BOB', 'ARS', 'CLP', 'COP', 'MXN', 'PEN', 'UYU', 'PYG', 'VES', 'CAD',
  'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'BGN', 'HRK', 'RSD', 'TRY', 'UAH', 'RUB',
  'KZT', 'GEL', 'AZN', 'AMD', 'INR', 'JPY', 'CNY', 'KRW', 'THB', 'VND', 'IDR', 'MYR', 'PHP', 'SGD', 'HKD',
  'TWD', 'ZAR', 'NGN', 'KES', 'GHS', 'TZS', 'UGX', 'EGP', 'MAD', 'TND', 'AED', 'SAR', 'QAR', 'KWD', 'ILS',
  'ISK', 'CRC', 'GTQ', 'HNL', 'NIO', 'DOP', 'PAB', 'BTC', 'ETH', 'USDT',
].filter((c) => c.length === 3);
