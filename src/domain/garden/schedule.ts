// When routines run. Daily and weekly times walk local calendar dates, not instants, so a fall-back day can't run
// twice and a spring-forward day still runs once.
import { LIMITS, newRun, type GardenRun, type Routine, type When } from './records.ts';

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

/**
 * The routine's alarm fired (or the worker started). Due: move `nextDue` on, fail its waiting runs, and queue a new
 * run unless one is still queued or running, in which case the slot is kept on `skipped`.
 */
export function claim(routine: Routine, runs: GardenRun[], now: number): { routine: Routine; newRun?: GardenRun; fail: string[] } {
  const mine = runs.filter((r) => r.routineId === routine.id);
  const due = !routine.paused && routine.nextDue <= now;
  const fail = mine.filter((r) => r.status === 'waiting' && (due || expired(r, now))).map((r) => r.id);
  if (!due) return { routine, fail };
  const next: Routine = { ...routine, nextDue: nextAfter(routine.when, routine.tz, routine.nextDue, now) };
  if (mine.some((r) => r.status === 'queued' || r.status === 'running')) {
    next.skipped = [...(routine.skipped ?? []), routine.nextDue].slice(-LIMITS.skipped);
    return { routine: next, fail };
  }
  const run = newRun({ id: `${routine.id}@${routine.nextDue}`, gardenerId: routine.gardenerId, routineId: routine.id, work: routine.work, now, ...(routine.skipped ? { skipped: routine.skipped } : {}) });
  delete next.skipped;
  next.lastRunId = run.id;
  return { routine: next, newRun: run, fail };
}
