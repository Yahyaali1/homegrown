// When routines run. Daily, weekly, monthly and one-off times walk local calendar dates, not instants, so a fall-back
// day can't run twice and a spring-forward day still runs once.
import { diffText } from '../compare.ts';
import { hostOf } from '../text.ts';
import { onSites } from './policy.ts';
import { dateOf, helping, LIMITS, newRun, type GardenRun, type Routine, type Trigger, type When, type Work } from './records.ts';

const HOUR = 3_600_000, DAY = 24 * HOUR;

/** Local wall time minus UTC, in ms, at instant `t` in `tz`. */
function offset(tz: string, t: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
}

/** The local calendar date of `t`, as a UTC midnight (so date arithmetic is plain). */
const localDate = (tz: string, t: number): number => {
  const l = t + offset(tz, t);
  return l - (((l % DAY) + DAY) % DAY);
};

/**
 * The instant a local wall time happens. A time that doesn't exist (spring forward) moves forward by the gap; an
 * ambiguous one (fall back) is its first instant.
 */
export function localInstant(tz: string, wall: number): number {
  const before = wall - offset(tz, wall - DAY), after = wall - offset(tz, wall + DAY);
  const real = [before, after].filter((t) => t + offset(tz, t) === wall).sort((a, b) => a - b);
  return real[0] ?? before;
}

/** The next due time strictly after `now`. `prevDue` null: a new or unpaused routine, counted from now. */
export function nextAfter(when: When, tz: string, prevDue: number | null, now: number): number {
  if (when.kind === 'every' || when.kind === 'event') {
    const from = prevDue ?? now, h = when.kind === 'every' ? when.hours * HOUR : when.every * 60_000;
    return from + Math.max(1, Math.floor((now - from) / h) + 1) * h;
  }
  const [hh, mm] = when.at.split(':').map(Number) as [number, number];
  // A one-off has its one slot, past or not: claim pauses the routine once it is due.
  if (when.kind === 'once') return localInstant(tz, dateOf(when.date)! + hh * HOUR + mm * 60_000);
  // Start at prevDue's own date: a spring-forward gap can push a slot past midnight, so the next date's slot may
  // still be due. Dates before today's can't be past now.
  let date = Math.max(prevDue === null ? 0 : localDate(tz, prevDue), localDate(tz, now));
  for (;; date += DAY) {
    if (when.kind === 'weekly' && !when.days.includes(new Date(date).getUTCDay())) continue;
    if (when.kind === 'monthly' && !onDay(when.on, new Date(date))) continue;
    const t = localInstant(tz, date + hh * HOUR + mm * 60_000);
    if (t > now && t > (prevDue ?? -Infinity)) return t;
  }
}

/** A monthly rule's day: the nth (or last) weekday, or the date (or the month's last day, when it is shorter). */
function onDay(on: Extract<When, { kind: 'monthly' }>['on'], d: Date): boolean {
  const day = d.getUTCDate(), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if ('date' in on) return day === Math.min(on.date, last);
  return d.getUTCDay() === on.day && (on.week === -1 ? day + 7 > last : Math.ceil(day / 7) === on.week);
}

/** The next `n` due times after `from`, for the routine form's preview (a one-off has one, or none once past). */
export function nextRuns(when: When, tz: string, from: number, n = 5): number[] {
  if (when.kind === 'once') {
    const t = nextAfter(when, tz, null, from);
    return t > from ? [t] : [];
  }
  const out: number[] = [];
  for (let t: number | null = null; out.length < n; ) out.push((t = nextAfter(when, tz, t, t ?? from)));
  return out;
}

/**
 * An event routine's check, outside any transaction: the page is fetched signed in only on the gardener's sites, and
 * compared with the last snapshot (`prev`; none: this is the first look, which only sets it). It fires when lines were
 * added and, with `onlyIf`, one of them holds one of its words. Code only: page text can't start a run any other way.
 */
export async function eventCheck(when: Extract<When, { kind: 'event' }>, sites: string[], prev: string | undefined,
  text: (url: string, credentials: RequestCredentials) => Promise<string>): Promise<{ text: string; trigger: Trigger | null }> {
  const signedIn = onSites(hostOf(when.url), sites);
  const now = await text(when.url, signedIn ? 'include' : 'omit');
  if (prev === undefined) return { text: now, trigger: null };
  const diff = diffText(prev, now);
  const added = diff.split('\n').filter((l) => l.startsWith('+ ')).map((l) => l.toLowerCase());
  const words = when.onlyIf?.map((w) => w.toLowerCase());
  const hit = added.length > 0 && (!words || added.some((l) => words.some((w) => l.includes(w))));
  return { text: now, trigger: hit ? { url: when.url, diff: diff.slice(0, LIMITS.output), signedIn } : null };
}

export const CHECK_MS = 30_000;

/**
 * The event check's fetch: at most 30 s. An error status fails the check (a 503 or a login wall must not become the
 * snapshot), and so does any redirect of a signed-in fetch, so cookies never follow it off the page's host.
 */
export async function checkFetch(url: string, credentials: RequestCredentials, get: typeof fetch = fetch): Promise<string> {
  const res = await get(url, { credentials, cache: 'no-store', redirect: credentials === 'include' ? 'manual' : 'follow', signal: AbortSignal.timeout(CHECK_MS) });
  if (!res.ok) throw new Error(res.type === 'opaqueredirect' ? 'The page redirected.' : `The page answered ${res.status}.`);
  return res.text();
}

/** A run past its one-off deadline: not done by then, it fails. */
export const overdue = (run: GardenRun, now: number): boolean =>
  run.deadline !== undefined && run.deadline <= now && (run.status === 'queued' || run.status === 'running' || run.status === 'waiting');
export const DEADLINE = 'Deadline passed.';

/** A waiting run whose open request is past `expiresAt`. */
export const expired = (run: GardenRun, now: number): boolean =>
  run.status === 'waiting' && run.requests.some((q) => !q.answer && q.expiresAt !== undefined && q.expiresAt <= now);

export const HELPERS = 3;

/**
 * What the queue runs next: the oldest queued run (a helper counts from its parent's time), or up to 3 queued helpers
 * of that parent together. A run waiting out its auto-retry (`retryAt`) is skipped until then.
 */
export function nextBatch(runs: GardenRun[], now: number): GardenRun[] {
  const at = (r: GardenRun) => (r.parentId ? runs.find((p) => p.id === r.parentId)?.queuedAt ?? r.queuedAt : r.queuedAt);
  const ready = runs.filter((r) => r.status === 'queued' && !(r.retryAt! > now)).sort((a, b) => at(a) - at(b) || a.queuedAt - b.queuedAt || (a.id < b.id ? -1 : 1));
  const first = ready[0];
  return !first ? [] : first.parentId ? ready.filter((r) => r.parentId === first.parentId).slice(0, HELPERS) : [first];
}

/**
 * The routine's alarm fired (or the worker started). Due: move `nextDue` on and queue a new run unless one is still
 * queued or running (its helpers too), in which case the slot is kept on `skipped`. A run waiting for the person
 * doesn't block: it fails only when its request expires. An event routine makes a run only with its check's
 * `trigger`. A one-off pauses; missed by more than its deadline, it makes no run (`missed`).
 */
export function claim(routine: Routine, runs: GardenRun[], now: number, trigger?: Trigger): { routine: Routine; newRun?: GardenRun; fail: string[]; missed?: true } {
  const mine = runs.filter((r) => r.routineId === routine.id);
  const due = !routine.paused && routine.nextDue <= now;
  // A parent waiting on its helpers is working, not waiting for the person.
  const fail = mine.filter((r) => r.status === 'waiting' && !helping(r) && expired(r, now)).map((r) => r.id);
  if (!due) return { routine, fail };
  const { when } = routine;
  const next: Routine = { ...routine, nextDue: nextAfter(when, routine.tz, routine.nextDue, now) };
  if (when.kind === 'event' && !trigger) return { routine: next, fail };
  const deadline = when.kind === 'once' && when.deadline ? routine.nextDue + when.deadline * 60_000 : undefined;
  if (when.kind === 'once') {
    next.paused = true;
    if (deadline !== undefined && deadline <= now) return { routine: { ...next, missed: true }, fail, missed: true };
  }
  // A one-off's only slot never waits on a run of it by hand (Run now): it would be lost.
  if (when.kind !== 'once' && mine.some((r) => r.status === 'queued' || r.status === 'running' || helping(r))) {
    next.skipped = [...(routine.skipped ?? []), routine.nextDue].slice(-LIMITS.skipped);
    return { routine: next, fail };
  }
  const run = newRun({ id: `${routine.id}@${routine.nextDue}`, gardenerId: routine.gardenerId, routineId: routine.id, work: routine.work, now,
    ...(routine.skipped && { skipped: routine.skipped }), ...(trigger && { trigger }), ...(deadline !== undefined && { deadline }) });
  delete next.skipped;
  next.lastRunId = run.id;
  return { routine: next, newRun: run, fail };
}

/** A routine the model proposed: paused, `by: 'model'`, until the person turns it on from an extension page. */
export const proposedRoutine = (o: { id: string; gardenerId: string; name: string; when: When; work: Work; tz: string; now: number }): Routine =>
  ({ v: 1, id: o.id, gardenerId: o.gardenerId, name: o.name.trim(), when: o.when, tz: o.tz, work: o.work, paused: true, by: 'model', nextDue: nextAfter(o.when, o.tz, null, o.now), createdAt: o.now });
