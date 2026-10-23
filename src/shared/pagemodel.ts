// The page model: what src/content/pageread.ts reads from a web page and what mission extraction consumes.
// Built from page content the extension doesn't control, so every field is plain data with sizes capped.

/** One thing on the page: a published product, a block in a repeated list, or a table row turned record. */
export interface PageRecord {
  title: string;
  url: string;
  price: number | null;
  currency: string;
  rating?: number | null;
  reviews?: number | string | null;
  brand?: string;
  sku?: string;
  gtin?: string;
  mpn?: string;
  availability?: string;
  image?: string;
  /** The block's text (lists): grounding and must-have checks read it. */
  text?: string;
  /** Labelled parts of a list block: class names, itemprops and data-labels → their text. */
  parts?: Record<string, string>;
  via: 'structured' | 'list';
}

export interface PageTable {
  caption: string;
  headers: string[] | null;
  rows: string[][];
  /** Label → value when the table is a facts table (an infobox, a spec sheet). */
  pairs: Record<string, string> | null;
  infobox: boolean;
}

export interface PageList {
  size: number;
  items: PageRecord[];
}

export interface PageModel {
  url: string;
  title: string;
  site: string;
  heading: string;
  structured: { products: PageRecord[]; other: Record<string, string>[]; meta: Record<string, string> };
  markdown: string;
  mainVia: 'readability' | 'main';
  tables: PageTable[];
  lists: PageList[];
  /** The page's visible text: model answers are checked against it. */
  text: string;
}

export interface ReadOptions {
  /** Scroll to the bottom first, so lazy-loaded items render. */
  scroll?: boolean;
  /** Replace shadow DOM hosts with plain copies (only in throwaway background tabs). */
  shadow?: boolean;
  /** Click in-page controls named after these terms ("2015" tabs) or that expand content ("show more"). */
  terms?: string[];
}

/** Merges child frames' content into the top frame's model (embedded shops, widgets). */
export function mergeFrames(frames: PageModel[], fallbackUrl: string): PageModel | null {
  const [main, ...inner] = frames;
  if (!main) return null;
  for (const f of inner.filter((f) => f.text.length > 40)) {
    main.lists.push(...f.lists);
    main.tables.push(...f.tables);
    main.structured.products.push(...f.structured.products);
    main.markdown += `\n\n${f.markdown}`;
    main.text += ` ${f.text}`;
  }
  return { ...main, url: main.url || fallbackUrl };
}
