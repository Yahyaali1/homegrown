// A run as a local report file the person can keep or pass on themselves; nothing is sent. Page text (step outputs,
// the model's replies and its answer) is left out unless the person asks for it. So is a digest that quotes what the
// model wrote (a note, draft, notify, search or goal): only digests whose first arg is a URL or recipe id stay.
import type { GardenRun } from './records.ts';

const URL_FIRST = ['read_page', 'read_my_tab', 'act', 'collect'];

export function reportOf(run: GardenRun, withText: boolean, version = '') {
  return {
    version, id: run.id, work: run.work.kind, model: run.model ?? null, status: run.status, why: run.why ?? null,
    best: !!run.best, queuedAt: run.queuedAt, endedAt: run.endedAt ?? null, usedMs: run.usedMs, tainted: run.tainted,
    steps: run.steps.map((s) => ({ i: s.i, tool: s.tool, state: s.state, digest: withText || URL_FIRST.includes(s.tool) ? s.digest ?? null : null, tries: s.tries ?? 0, ...(withText && { output: s.output ?? s.error ?? '' }) })),
    ...(withText && { answer: run.answer ?? null, turns: run.turns.map((t) => ({ purpose: t.purpose, reply: t.reply })) }),
  };
}
