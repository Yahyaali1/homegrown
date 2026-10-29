// When routines run. Daily and weekly times walk local calendar dates, not instants, so a fall-back day can't run
// twice and a spring-forward day still runs once.
import { helping, LIMITS, newRun, type GardenRun, type Routine, type When, type Work } from './records.ts';

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
  if (when.kind === 'every') {
    const from = prevDue ?? now, h = when.hours * HOUR;
    return from + Math.max(1, Math.floor((now - from) / h) + 1) * h;
  }
  const [hh, mm] = when.at.split(':').map(Number) as [number, number];
  // Start at prevDue's own date: a spring-forward gap can push a slot past midnight, so the next date's slot may
  // still be due. Dates before today's can't be past now.
  let date = Math.max(prevDue === null ? 0 : localDate(tz, prevDue), localDate(tz, now));
  for (;; date += DAY) {
    if (when.kind === 'weekly' && !when.days.includes(new Date(date).getUTCDay())) continue;
    const t = localInstant(tz, date + hh * HOUR + mm * 60_000);
    if (t > now && t > (prevDue ?? -Infinity)) return t;
  }
}

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
 * The routine's alarm fired (or the worker started). Due: move `nextDue` on, fail its waiting runs, and queue a new
 * run unless one is still queued or running, in which case the slot is kept on `skipped`.
 */
export function claim(routine: Routine, runs: GardenRun[], now: number): { routine: Routine; newRun?: GardenRun; fail: string[] } {
  const mine = runs.filter((r) => r.routineId === routine.id);
  const due = !routine.paused && routine.nextDue <= now;
  // A parent waiting on its helpers is working, not waiting for the person.
  // A helper isn't failed for a new slot (no next run starts for it); only when its wait expires.
  const fail = mine.filter((r) => r.status === 'waiting' && !helping(r) && ((due && !r.parentId) || expired(r, now))).map((r) => r.id);
  if (!due) return { routine, fail };
  const next: Routine = { ...routine, nextDue: nextAfter(routine.when, routine.tz, routine.nextDue, now) };
  if (mine.some((r) => r.status === 'queued' || r.status === 'running' || helping(r))) {
    next.skipped = [...(routine.skipped ?? []), routine.nextDue].slice(-LIMITS.skipped);
    return { routine: next, fail };
  }
  const run = newRun({ id: `${routine.id}@${routine.nextDue}`, gardenerId: routine.gardenerId, routineId: routine.id, work: routine.work, now, ...(routine.skipped ? { skipped: routine.skipped } : {}) });
  delete next.skipped;
  next.lastRunId = run.id;
  return { routine: next, newRun: run, fail };
}

/** A routine the model proposed: paused, `by: 'model'`, until the person turns it on from an extension page. */
export const proposedRoutine = (o: { id: string; gardenerId: string; name: string; when: When; work: Work; tz: string; now: number }): Routine =>
  ({ v: 1, id: o.id, gardenerId: o.gardenerId, name: o.name.trim(), when: o.when, tz: o.tz, work: o.work, paused: true, by: 'model', nextDue: nextAfter(o.when, o.tz, null, o.now), createdAt: o.now });
