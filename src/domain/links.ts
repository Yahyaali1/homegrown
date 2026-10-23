// A local phishing check on a link itself, before anything is fetched.

const BRANDS = ['paypal', 'google', 'microsoft', 'apple', 'amazon', 'facebook', 'netflix', 'instagram', 'whatsapp', 'linkedin', 'outlook', 'office', 'chase', 'wellsfargo', 'bankofamerica', 'coinbase', 'binance', 'github', 'dropbox', 'icloud'];
const DIGITS: Record<string, string> = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };

/** Warnings about where a link really goes, given its href and visible text. */
export function linkWarnings(href: string, text: string): string[] {
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  const warn: string[] = [];
  const shown = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(text.trim())?.[1]?.toLowerCase().replace(/^www\./, '');
  if (shown && host !== shown && !host.endsWith(`.${shown}`)) warn.push(`The link text says ${shown}, but it goes to ${host}.`);
  if (host.split('.').some((p) => p.startsWith('xn--'))) warn.push(`${host} uses lookalike characters (punycode).`);
  const label = host.split('.').slice(-2, -1)[0] ?? '';
  const undigited = label.replace(/[0134578]/g, (d) => DIGITS[d]!);
  const brand = BRANDS.find((b) => undigited.includes(b) && !label.includes(b));
  if (brand) warn.push(`${host} looks like “${brand}” with digits swapped for letters.`);
  if (url.protocol === 'http:') warn.push('The page is not encrypted (http).');
  return warn;
}
