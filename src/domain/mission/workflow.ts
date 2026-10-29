// Workflows from outside the runner (saved missions, Mission control edits, older versions) are checked here, once,
// so the runner can trust every field. Missing numbers get the defaults older versions assumed.
import type { Brief, Op, Step, Workflow } from './types.ts';
import { parseScenario } from '../scrape/scenario.ts';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const count = (v: unknown, fallback: number, max = 50): number => {
  const n = parseInt(text(v), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};
const OPS: readonly Op[] = ['<', '>', 'contains', '='];

function step(raw: unknown): Step | null {
  const s = obj(raw);
  switch (s?.type) {
    case 'search': {
      const urls = texts(s.urls).filter((u) => /^https?:/.test(u));
      return { type: 'search', query: text(s.query), n: count(s.n, 8), ...(urls.length && { urls }) };
    }
    case 'open': {
      // Steps before reading come only from the user (Mission control, a saved mission); the planner never writes them.
      const scenario = s.scenario == null ? null : parseScenario(s.scenario);
      return { type: 'open', limit: count(s.limit, 6), ...(scenario && { scenario }) };
    }
    case 'extract': {
      const fields = texts(s.fields);
      return fields.length ? { type: 'extract', fields, require: texts(s.require) } : null;
    }
    case 'filter': return { type: 'filter', field: text(s.field), op: OPS.includes(s.op as Op) ? (s.op as Op) : '<', value: text(s.value) };
    case 'rank': return s.by ? { type: 'rank', by: text(s.by), order: s.order === 'desc' ? 'desc' : 'asc', keep: count(s.keep, 5, 20) } : null;
    case 'answer': return { type: 'answer', question: text(s.question) || 'Summarize the findings.' };
    default: return null;
  }
}

function brief(raw: unknown): Brief | null {
  const b = obj(raw);
  if (!b) return null;
  const budget = obj(b.budget);
  const rank = obj(b.rank);
  const want = obj(b.want);
  const value = Number(budget?.value);
  return {
    subject: text(b.subject),
    subjectWords: texts(b.subjectWords),
    must: texts(b.must),
    avoid: texts(b.avoid),
    prefer: texts(b.prefer),
    budget: budget && value > 0 ? { op: budget.op === '>' ? '>' : '<', value, currency: text(budget.currency) } : null,
    rank: rank?.by ? { by: text(rank.by), order: rank.order === 'desc' ? 'desc' : 'asc' } : null,
    want: { kind: want?.kind === 'list' ? 'list' : 'one', n: count(want?.n, 3, 20) },
    shopping: !!b.shopping,
  };
}

/** A runnable workflow, or null when it can't run (no goal, or no search to start from). */
export function parseWorkflow(raw: unknown): Workflow | null {
  const w = obj(raw);
  const goal = text(w?.goal).trim();
  const steps = (Array.isArray(w?.steps) ? w.steps : []).map(step).filter((s): s is Step => !!s);
  // One Open step at most: its steps before reading are what the user confirms, so there is one place to look.
  if (!w || !goal || steps[0]?.type !== 'search' || steps.filter((s) => s.type === 'open').length > 1) return null;
  const planner = w.planner === 'gemma' ? 'model' : w.planner; // saved before planners were model-neutral
  return {
    goal,
    steps,
    brief: brief(w.brief),
    ...((planner === 'model' || planner === 'template' || planner === 'shopping sense') && { planner }),
  };
}
