// CSV for spreadsheets. Cells come from web pages, so one that starts like a formula is prefixed with ' (OWASP CSV
// injection): a spreadsheet would otherwise run "=HYPERLINK(…)" from a scraped page.
const FORMULA = /^[=+\-@\t\r]/;

export const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return `"${(FORMULA.test(s) && !/^[-+]?\d[\d.,]*$/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export const toCsv = (keys: string[], rows: Record<string, unknown>[]): string =>
  [keys.map(csvCell).join(','), ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(','))].join('\n');
