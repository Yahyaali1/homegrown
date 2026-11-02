// The request tray: the open requests across runs, at the top of Garden and above the chat input. Each tray keeps
// its rows by request, so a typed answer or an edit survives the next broadcast. The worker checks every answer again.
import { busyButton, button, errLine, fail, labelled, tryIt } from './shell.ts';
import { h } from '../ui/dom.ts';
import { flower, runStage } from '../ui/flower.ts';
import { questions } from '../ui/questions.ts';
import { alwaysOk, approveAllOk, SENSITIVE_WAIT } from '../domain/garden/policy.ts';
import { editOk } from '../domain/garden/loop.ts';
import type { GardenRun, Look, PlannedCall, Request } from '../domain/garden/records.ts';
import { bg } from '../shared/protocol.ts';

export type Open = { run: GardenRun; q: Request };
type Row = HTMLLIElement & { sync?: (q: Request) => void };
interface TrayDeps {
  nameOf: (run: GardenRun) => string;
  lookFor: (gardenerId: string) => Look;
  who: (gardenerId: string) => string;
  /** A new row's entrance, and keeping rows in place (garden.ts). */
  fresh: (li: HTMLLIElement) => HTMLLIElement;
  place: (parent: HTMLElement, nodes: Node[]) => void;
  /** After an "always": the gardener's allowed actions changed. */
  granted: (gardenerId: string) => void;
}

/** A tray in `host`; call the result with the open requests to show. */
export function tray(host: HTMLElement, d: TrayDeps): (open: Open[]) => void {
  const rows = new Map<string, Row>();
  let eligible: Open[] = [];
  const err = errLine();
  const all = labelled(busyButton('Approve all', tryIt(err, () => bg('requestAnswerAll', { requests: eligible.map(({ run, q }) => ({ runId: run.id, requestId: q.id })) })), 'secondary'),
    'Approve all pages to open and actions in its own tabs');
  const count = h('span', { className: 'p' });
  const bar = h('li', { className: 'tray-bar' }, h('span', { className: 't' }, count, err), all);
  return (open) => {
    eligible = open.filter(({ run, q }) => approveAllOk(q, run));
    count.textContent = `${eligible.length} of ${open.length} can be approved together: pages to open and actions in its own tabs. Sensitive ones, questions and plans still ask one by one.`;
    const keep = new Map(open.map(({ run, q }) => {
      const key = `${run.id}/${q.id}`;
      const li = rows.get(key) ?? requestRow(run, q, d);
      li.sync?.(q); // shownAt arrives with the next broadcast
      return [key, li] as const;
    }));
    rows.clear();
    for (const [k, li] of keep) rows.set(k, li);
    d.place(host, [...(eligible.length > 1 ? [bar] : []), ...keep.values()]);
  };
}

let rowIds = 0;
function requestRow(run: GardenRun, q: Request, d: TrayDeps): Row {
  const err = errLine();
  const textId = `req-${++rowIds}`; // the same request shows in two trays
  const answer = (value: string, more: { calls?: PlannedCall[]; args?: Record<string, unknown> } = {}) => bg('requestAnswer', { runId: run.id, requestId: q.id, value, ...more })
    .then(() => (value === 'always' ? d.granted(run.gardenerId) : undefined)).catch((e) => fail(err, e));
  const described = <T extends HTMLElement>(el: T) => (el.setAttribute('aria-describedby', textId), el);
  const edit = editOk(q) ? argFields(q) : null;
  // An edited yes carries the args (or says why they can't be read).
  const yesNo = (...more: HTMLElement[]) => {
    const yes = described(busyButton('Yes', tryIt(err, async () => answer('yes', edit?.args() ? { args: edit.args()! } : {})), 'primary'));
    return { yes, el: h('div', { className: 'row' }, yes, described(busyButton('No', () => answer('no'), 'secondary')), ...more) };
  };
  const lead: HTMLElement[] = [];
  let reply: HTMLElement;
  let sync: Row['sync'];
  if (q.kind === 'question' && q.questions?.length) {
    reply = questions(q.questions, (a) => void answer(JSON.stringify(a)));
  } else if (q.kind === 'question') {
    const box = described(h('input', { placeholder: 'Your answer', maxLength: 2000, attrs: { 'aria-label': 'Your answer' } }));
    reply = h('form', { className: 'row' }, box, h('button', { className: 'primary', textContent: 'Send' }));
    reply.onsubmit = (e) => (e.preventDefault(), box.value.trim() && void answer(box.value.trim()));
  } else if (q.kind === 'approve' && q.sensitive) {
    // The worker refuses yes until 8 s after it was shown (its shownAt): the wait is words and a 2px bar, no ring.
    const { yes, el } = yesNo();
    yes.disabled = true;
    const wait = h('span', { className: 'muted small', textContent: 'Read it first.' });
    const bar = h('div', { className: 'wait-bar', hidden: true }); // shown, and so animated, once shownAt is known
    let timer = 0;
    sync = (r) => {
      if (r.shownAt === undefined || timer) return;
      const tick = () => {
        const left = r.shownAt! + SENSITIVE_WAIT + 250 - Date.now();
        if (left <= 0 || !bar.isConnected) {
          clearInterval(timer);
          yes.disabled = false;
          wait.textContent = 'Check the steps above, then answer.';
          bar.remove();
          return;
        }
        wait.textContent = `Read it first: Yes opens in ${Math.ceil(left / 1000)} s.`;
      };
      bar.style.animationDuration = `${Math.max(0, r.shownAt + SENSITIVE_WAIT - Date.now())}ms`;
      bar.hidden = false;
      timer = window.setInterval(tick, 500);
      tick();
    };
    lead.push(h('span', { className: 'p', textContent: `Sensitive, on ${q.host ?? 'this site'}: you are asked every time.` }));
    reply = h('div', { className: 'stack' }, ...(edit ? [edit.el] : []), bar, wait, el);
  } else if (q.kind === 'approve' && !alwaysOk(q)) {
    // In the person's own tab, or an app tool not marked Read: asked every time, so no Always.
    lead.push(h('span', { className: 'p', textContent: q.appWrite ? `Sends data to an app at ${q.host}: you are asked every time.` : `In your own tab on ${q.host}: you are asked every time.` }));
    reply = h('div', { className: 'stack' }, ...(edit ? [edit.el] : []), yesNo().el);
  } else if (q.kind === 'approve') {
    const hint = h('span', { className: 'muted small', id: `${textId}-always`, textContent: `Always: allow this exact action on ${q.host} without asking again. Revoke it under the gardener.` });
    const always = labelled(busyButton('Always', () => answer('always'), 'ghost'), `Always allow this exact action on ${q.host}`);
    always.setAttribute('aria-describedby', hint.id);
    // An edited action is a new one: Always would allow the original, so it goes while the fields differ.
    if (edit) edit.el.oninput = () => (always.hidden = hint.hidden = edit.changed());
    lead.push(h('span', { className: 'p', textContent: `On ${q.host}` }));
    reply = h('div', { className: 'stack' }, ...(edit ? [edit.el] : []), yesNo(always).el, hint);
  } else if (q.kind === 'plan') {
    const plan = planList(q.calls ?? []);
    lead.push(h('span', { className: 'p', textContent: 'Yes runs these steps in this order. The pages in it may open; acts that turn sensitive, and anything not in it, still ask.' }));
    const yes = described(busyButton('Yes', tryIt(err, async () => answer('yes', { calls: plan.calls() })), 'primary'));
    reply = h('div', { className: 'stack' }, plan.el, h('div', { className: 'row' }, yes, described(busyButton('No', () => answer('no'), 'secondary'))));
  } else if (q.kind === 'help') {
    // Done reads the page again; Skip fails that step.
    const show = labelled(busyButton('Show me', tryIt(err, async () => {
      const t = await chrome.tabs.update(q.tabId!, { active: true });
      if (t) await chrome.windows.update(t.windowId, { focused: true });
    }), 'secondary'), 'Show me the tab that asks');
    reply = h('div', { className: 'row' }, show, described(busyButton('Done', () => answer('yes'), 'primary')), described(busyButton('Skip', () => answer('no'), 'ghost')));
  } else if (q.kind === 'takeover') {
    // Handing back: a read the person interrupted runs again; an act asks whether it happened.
    reply = h('div', { className: 'row' }, described(busyButton(`Hand back to ${d.who(run.gardenerId)}`, () => answer('yes'), 'primary')));
  } else {
    if (q.kind === 'did-it-happen') lead.push(h('span', { className: 'p', textContent: 'Homegrown stopped while this was running, so it can’t tell whether it happened. Check the page, then answer.' }));
    reply = yesNo().el;
  }
  const li: Row = d.fresh(h('li', { className: 'request' }, flower(26, runStage(run), d.lookFor(run.gardenerId)),
    h('span', { className: 't' }, h('b', { textContent: d.nameOf(run) }), ...lead, h('span', { className: 'result', id: textId, textContent: q.text }), reply, err)));
  if (sync) li.sync = sync;
  return li;
}

/**
 * An approve's call as fields to edit before Yes: text args as text, the rest as JSON. `args()` is undefined while
 * nothing changed; the worker parses an edit again and checks it as a new call.
 */
function argFields(q: Request): { el: HTMLElement; changed: () => boolean; args: () => Record<string, unknown> | undefined } {
  let call: Record<string, unknown> = {};
  try {
    call = JSON.parse(q.argsKey ?? '{}') as Record<string, unknown>;
  } catch {}
  const fields = Object.entries(call).map(([k, v]) => {
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    const el = text.length > 60 ? h('textarea', { rows: 3, value: text }) : h('input', { value: text });
    el.setAttribute('aria-label', `Edit ${k}`);
    return { k, text, el, json: typeof v !== 'string' };
  });
  const changed = () => fields.some((f) => f.el.value !== f.text);
  const read = (f: (typeof fields)[number]) => {
    try {
      return f.json ? JSON.parse(f.el.value) as unknown : f.el.value;
    } catch {
      throw new Error(`${f.k} isn’t valid JSON.`);
    }
  };
  return {
    el: h('div', { className: 'stack edit' }, ...fields.flatMap((f) => [h('span', { className: 'p', textContent: f.k }), f.el])),
    changed,
    args: () => (changed() ? Object.fromEntries(fields.map((f) => [f.k, read(f)])) : undefined),
  };
}

/** A plan to edit before Yes: delete and reorder steps, change a step's arguments (JSON; the worker checks them again). */
function planList(calls: PlannedCall[]): { el: HTMLOListElement; calls: () => PlannedCall[] } {
  const el = h('ol', { className: 'stack' }, ...calls.map((c) => {
    const what = `${c.tool} ${String(Object.values(c.args)[0] ?? '').slice(0, 80)}`;
    const args = h('textarea', { rows: 2, value: JSON.stringify(c.args), attrs: { 'aria-label': `Arguments: ${what}` } });
    const li: HTMLLIElement = h('li', { dataset: { tool: c.tool } }, h('b', { textContent: c.tool }), args,
      h('div', { className: 'row' },
        labelled(button('↑', () => li.previousElementSibling?.before(li), 'ghost'), `Move up: ${what}`),
        labelled(button('↓', () => li.nextElementSibling?.after(li), 'ghost'), `Move down: ${what}`),
        labelled(button('✕', () => li.remove(), 'ghost'), `Delete: ${what}`)));
    return li;
  }));
  const read = (li: HTMLLIElement, j: number): PlannedCall => {
    try {
      return { tool: li.dataset.tool!, args: JSON.parse(li.querySelector('textarea')!.value) as Record<string, unknown> };
    } catch {
      throw new Error(`Step ${j + 1}’s arguments aren’t valid JSON.`);
    }
  };
  return { el, calls: () => [...el.querySelectorAll<HTMLLIElement>(':scope > li')].map(read) };
}
