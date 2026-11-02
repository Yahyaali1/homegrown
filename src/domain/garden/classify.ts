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

const WORDS = /\b(pay|buy|order|purchase|check ?out|delete|remove|send|transfer|refund|repl(y|ies)|post(s|ed|ing)?\b|(un)?subscribe|confirm|password)/i;
const READS = /^(get|list|read|search|fetch|find)\b/i;
const split = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * The first sensitive word in an app call (its tool name, then its args; `delete_contact`, `sendEmail` split into
 * words), or null. A tool named for reading (`get_payment`, `list_payouts`) only reads about payments.
 */
export function sensitiveWord(text: string): string | null {
  const [name = '', ...rest] = text.split(' ');
  const head = split(name);
  return WORDS.exec(`${READS.test(head) ? head.replace(/\bpay\w*/gi, '') : head} ${split(rest.join(' '))}`)?.[0] ?? null;
}

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

/**
 * Where check-for-humans widgets load from (reCAPTCHA, hCaptcha, Arkose): host, then a path prefix. Turnstile is left
 * out: its widget sits on ordinary forms and mostly passes alone; Cloudflare's interstitial is known by its title.
 */
const CHALLENGE_HOSTS = ['google.com/recaptcha/', 'recaptcha.net/recaptcha/', 'hcaptcha.com/', 'arkoselabs.com/', 'funcaptcha.com/'];
const HUMAN = /verify (that )?you(’|')?re (a )?human|verify (that )?you are (a )?human|are you a robot|checking (if the site connection is secure|your browser)/i;
/** Below this much page text, a page is little more than what it shows (an interstitial). */
const SHORT = 600;

/**
 * A page that stands between the run and its content, asking for a person: a title that says so, or a short page
 * whose text says so or that shows a visible challenge frame. A widget on a full page (a login or contact form) isn't.
 */
export function isChallenge(p: { frames: string[]; title: string; text: string }): boolean {
  const title = p.title.trim();
  if (HUMAN.test(title) || /^just a moment|^attention required|press (&|and) hold/i.test(title)) return true;
  if (p.text.replace(/\s+/g, ' ').trim().length >= SHORT) return false;
  return HUMAN.test(p.text) || p.frames.some((f) => {
    try {
      const u = new URL(f);
      if (/size=invisible/.test(u.search + u.hash)) return false;
      const at = u.hostname.replace(/^www\./, '') + u.pathname;
      return CHALLENGE_HOSTS.some((c) => at.startsWith(c) || at.includes(`.${c}`));
    } catch {
      return false;
    }
  });
}
