// Shared by every extension page: the flower marks and a checked query helper.
import { markPage } from '../ui/flower.ts';

// The theme itself is applied by ui/theme.js in each page's <head>, before the first paint.
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', markPage);
else markPage();

/** The first element matching `selector` (pages own their markup, so a miss is a bug worth an error). */
export function $<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector} on this page`);
  return el;
}
