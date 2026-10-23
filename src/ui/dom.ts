// One typed way to build DOM (docs/architecture.md, ADR-7). Text always goes in as text; there is no innerHTML path
// for data. Trusted static markup (the flower SVG, a component's own template) goes through `fromHtml`.
export type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>> & {
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
};
export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { style, dataset, attrs, ...rest } = props;
  Object.assign(el, rest);
  if (typeof style === 'string') el.style.cssText = style;
  else if (style) Object.assign(el.style, style);
  if (dataset) Object.assign(el.dataset, dataset);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
  el.append(...children.filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (typeof c === 'number' ? String(c) : c)));
  return el;
}

/** Trusted, static markup only (our own templates): never page or model text. */
export function fromHtml<T extends Element = Element>(markup: string): T {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t.content.firstElementChild as T;
}
