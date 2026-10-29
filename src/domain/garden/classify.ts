// Is an acting step safe to run on this element? Pure, and bundled into the page script (lib/pageread.js), so the
// check and the act happen in one injected call on the same element.

/** Facts about the element an acting step is about to use, read in the page just before it runs. */
export interface Target {
  action: 'click' | 'fill' | 'evaluate';
  found: boolean;
  pageUrl: string;
  tag?: string;
  type?: string;
  autocomplete?: string;
  /** The button or link's text, value, title and image alts. */
  text?: string;
  label?: string;
  /** Where the element's form posts, resolved. */
  formAction?: string;
  /** A link's target, resolved. */
  href?: string;
  tainted?: boolean;
}

const host = (u: string | undefined): string => {
  try {
    return new URL(u ?? '').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const WORDS = /\b(pay|buy|order|purchase|check ?out|delete|remove|send|transfer|(un)?subscribe|confirm|password)/i;

/** Why this step is sensitive (always asked, never granted), or null: it may be granted. */
export function classify(t: Target): string | null {
  if (t.action === 'evaluate') return 'it runs code';
  if (!t.found) return 'its target isn’t on the page';
  if (t.action === 'fill' && t.tainted) return 'it types into a page after reading your signed-in pages';
  if (t.type?.toLowerCase() === 'password') return 'a password field';
  const auto = (t.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (auto.some((a) => a.startsWith('cc-'))) return 'a payment card field';
  if (auto.some((a) => a === 'current-password' || a === 'new-password')) return 'a password field';
  const words = [t.text, t.label].map((x) => (x ?? '').replace(/\s+/g, ' ').trim()).find((x) => WORDS.test(x));
  if (words) return `“${words.slice(0, 60)}”`;
  const page = host(t.pageUrl);
  if (t.formAction && host(t.formAction) !== page) return `a form that sends to ${host(t.formAction) || t.formAction.slice(0, 60)}`;
  if (t.href && /^https?:/.test(t.href) && host(t.href) !== page) return `a link to ${host(t.href)}`;
  return null;
}

/** What the worker allows for one acting step: its hosts, and the one sensitive yes the person gave (if any). */
export interface Check {
  hosts: string[];
  tainted: boolean;
  /** The step's index in its scenario. */
  index: number;
  /** A sensitive yes: for this reason, and (when set) this step only. */
  ok?: { index?: number; why: string } | undefined;
}

/** Go, or stop: off the call's hosts (`host`), or sensitive without a matching yes. `passed`: it went on that yes. */
export function verdict(t: Target, c: Check): { stop?: string; host?: true; passed?: true } {
  const at = host(t.pageUrl);
  if (!c.hosts.includes(at)) return { stop: `the page moved to ${at || 'another page'}, off ${c.hosts.join(', ')}`, host: true };
  const why = classify({ ...t, tainted: c.tainted });
  if (!why) return {};
  return c.ok && c.ok.why === why && (c.ok.index === undefined || c.ok.index === c.index) ? { passed: true } : { stop: why };
}
