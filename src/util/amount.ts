/**
 * Parses a money amount as found in game UIs: "0.10", "0,10", "1,000.50", "1.000,50", "€ 2", "100".
 * Returns undefined when the text is not a number.
 */
export function parseAmount(raw: string | number | null | undefined): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return undefined;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // the separator that appears last is the decimal separator
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3 && parts[0] !== '0' && parts[0] !== '');
    s = isThousands ? parts.join('') : s.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2) s = parts.join(''); // 1.000.000
  }
  const value = Number.parseFloat(s);
  return Number.isFinite(value) ? value : undefined;
}

const EPSILON = 1e-6;

export function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

export function formatAmount(value: number | undefined): string {
  if (value === undefined) return '';
  // at least two decimals ("0.10", "100.00"), more only when needed ("0.125")
  const fixed = value.toFixed(2);
  return amountsEqual(Number(fixed), value) ? fixed : String(Number(value.toFixed(6)));
}
