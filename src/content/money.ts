// Prices and ratings as written on pages. Pure: shared by the page reader and its tests.

const SYMBOL: Record<string, string> = {
  $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', zł: 'PLN', kr: 'SEK', 'A$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'US$': 'USD',
};
const MONEY = /(US\$|CA\$|A\$|C\$|[$€£¥₹₩]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|SEK|PLN|PKR|AED)\b)\s?(\d+(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)|(\d+(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s?(€|zł|kr|\b(?:USD|EUR|GBP|INR|CHF|SEK|PLN|PKR|AED)\b)/;

/** "$295.99" → 295.99; "1.299,99" → 1299.99. */
export function toNumber(s: unknown): number | null {
  let t = (/-?\d[\d.,\s]*/.exec(String(s ?? '')) ?? [''])[0].replace(/\s/g, '');
  if (/,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** "$1,299.99", "1.299,99 €", "EUR 49" → { price, currency }; null when there is no price. */
export function money(text: string | null | undefined): { price: number | null; currency: string } | null {
  const m = MONEY.exec(text ?? '');
  if (!m) return null;
  const cur = (m[1] ?? m[4] ?? '').trim();
  return { price: toNumber(m[2] ?? m[3]), currency: SYMBOL[cur] ?? cur.toUpperCase() };
}

/** "4.5 out of 5", "4/5", "4.5 stars" → 4.5. */
export function rating(text: string | null | undefined): number | null {
  const m = /(\d(?:[.,]\d)?)\s*(?:out of|\/)\s*5|(\d[.,]\d)\s*(?:stars?|★)/i.exec(text ?? '');
  return m ? toNumber(m[1] ?? m[2]) : null;
}
