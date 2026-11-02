// A gardener's routines: each with Pause, Run now and its pages, and the form that adds one (or asks now).
import { busyButton, errLine, fail, labelled, tryIt } from './shell.ts';
import { h } from '../ui/dom.ts';
import { nextRuns } from '../domain/garden/schedule.ts';
import { isWorking, noPage, NO_PAGE, parseWhen, type Gardener, type Mention, type When, type Work } from '../domain/garden/records.ts';
import { NEEDS, tested } from '../domain/garden/skills.ts';
import { bg } from '../shared/protocol.ts';
import { at, lacks, lines, renderGarden, runs, S, select, type Can, type Listed } from './garden-state.ts';

export const routineForms = new Map<string, HTMLDetailsElement>(); // gardener id → its open, half-filled form survives
export const nextLines = new Map<string, HTMLElement>(); // routine id → its "Next:" line

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKS: [string, string][] = [['1', 'First'], ['2', 'Second'], ['3', 'Third'], ['4', 'Fourth'], ['-1', 'Last']];
function whenText(w: When): string {
  if (w.kind === 'every') return `every ${w.hours === 1 ? 'hour' : `${w.hours} hours`}`;
  if (w.kind === 'daily') return `daily at ${w.at}`;
  if (w.kind === 'weekly') return `${w.days.map((d) => DAYS[d]).join(', ')} at ${w.at}`;
  if (w.kind === 'monthly') {
    const on = 'date' in w.on ? `day ${w.on.date}` : `the ${WEEKS.find(([v]) => Number(v) === (w.on as { week: number }).week)![1].toLowerCase()} ${DAYS[w.on.day]}`;
    return `monthly on ${on} at ${w.at}`;
  }
  if (w.kind === 'once') return `once on ${w.date} at ${w.at}${w.deadline ? `, deadline ${w.deadline} min` : ''}`;
  return `when ${w.url || 'its page'} changes (checked every ${w.every} min)${w.onlyIf ? ` and mentions ${w.onlyIf.join(', ')}` : ''}`;
}
const workText = (w: Work) => (w.kind === 'read' ? `reads ${!w.urls.length ? 'a page you set' : w.urls.length === 1 ? w.urls[0] : `${w.urls.length} pages`}` : w.kind === 'mission' ? `mission: ${w.goal}` : `${w.kind === 'plan' ? 'plans' : 'asks'}: ${w.request}`);
/** A one-off that fired: Done once no run of it (helpers too) still works. */
const nextText = (r: Listed) => (r.when.kind === 'once' && r.paused && r.next <= Date.now()
  ? (r.missed ? 'Missed: its deadline passed' : [...runs.values()].some((x) => x.routineId === r.id && isWorking(x)) ? 'Working…' : 'Done')
  : r.paused ? 'Paused' : `${r.when.kind === 'event' ? 'Next check' : 'Next'}: ${at(r.next)}`);

export function routineItem(r: Listed): HTMLLIElement {
  const err = errLine();
  // A routine the gardener (or a preset) proposed stays off until the person turns it on here.
  const proposed = r.paused && r.by !== undefined && r.by !== 'person';
  const fired = r.when.kind === 'once' && r.paused && r.next <= Date.now(); // nothing to resume
  const blocked = lacks(r) || noPage(r.work);
  const who = S.gardeners.find((x) => x.id === r.gardenerId)?.name ?? 'a gardener';
  const next = h('span', { className: 'result', textContent: noPage(r.work) ? NO_PAGE : blocked ? NEEDS : proposed ? (r.by === 'preset' ? `From ${who}’s pack, off. Turn on?` : `Proposed by ${who}. Turn on?`) : nextText(r) });
  nextLines.set(r.id, next);
  return h('li', {},
    h('span', { className: 't' }, h('b', { textContent: r.name }), h('span', { className: 'p', textContent: `${whenText(r.when)} · ${workText(r.work)}` }),
      // Proposed: every page it would read, before the person turns it on (the goal and request are in full above).
      proposed && r.work.kind === 'read' && r.work.urls.length > 0 && h('span', { className: 'result', textContent: r.work.urls.join('\n') }), next),
    h('div', { className: 'actions' },
      !fired && !(blocked && r.paused) && labelled(busyButton(proposed ? 'Turn on' : r.paused ? 'Resume' : 'Pause', tryIt(err, async () => (await bg('routineSave', { routine: { ...r, paused: !r.paused } }), await renderGarden())), 'ghost'), `${proposed ? 'Turn on' : r.paused ? 'Resume' : 'Pause'} ${r.name}`),
      !blocked && labelled(busyButton('Run now', tryIt(err, () => bg('gardenRun', { routineId: r.id })), 'secondary'), `Run ${r.name} now`),
      labelled(busyButton('Delete', tryIt(err, async () => (await bg('routineDelete', { id: r.id }), await renderGarden())), 'ghost'), `Delete ${r.name}`)),
    pagesBox(r, err),
    err);
}

/** A read routine's pages, set or replaced (the worker checks them against the gardener's sites); an event watches the first. */
function pagesBox(r: Listed, err: HTMLElement): HTMLElement | null {
  if (r.work.kind !== 'read') return null;
  const urls = h('textarea', { rows: 2, defaultValue: r.work.urls.join('\n'), placeholder: 'Pages, one URL per line, on its sites', attrs: { 'aria-label': `Pages for ${r.name}` } });
  const save = busyButton('Save pages', tryIt(err, async () => {
    const list = lines(urls.value);
    const when = r.when.kind === 'event' ? { ...r.when, url: list[0] ?? '' } : r.when;
    await bg('routineSave', { routine: { ...r, when, work: { kind: 'read', urls: list } } });
    await renderGarden();
  }), 'secondary');
  return h('details', { open: noPage(r.work) }, h('summary', { textContent: noPage(r.work) ? 'Set the page' : 'Change pages' }), urls, h('div', { className: 'row' }, save));
}

/** A routine's new run moved its next time: only the "Next:" lines change. */
export async function refreshNext(): Promise<void> {
  S.routines = await bg<Listed[]>('routineList').catch(() => S.routines);
  for (const r of S.routines) {
    const el = nextLines.get(r.id);
    if (el && !(r.paused && r.by !== undefined && r.by !== 'person') && !lacks(r) && !noPage(r.work)) el.textContent = nextText(r);
  }
}

export function routineForm(g: Gardener, ask: Can): HTMLFormElement {
  const name = h('input', { placeholder: 'Name, e.g. Morning check', required: true, maxLength: 80, attrs: { 'aria-label': 'Routine name' } });
  const kind = select('When', [['every', 'Every few hours'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['once', 'Once'], ['event', 'When a page changes']]);
  const hours = h('input', { type: 'number', min: '1', max: '24', defaultValue: '6', attrs: { 'aria-label': 'Hours between runs' } });
  const time = h('input', { type: 'time', defaultValue: '08:00', attrs: { 'aria-label': 'Time' } });
  const days = DAYS.map((d, i) => h('input', { type: 'checkbox', value: String(i), defaultChecked: i === 1, attrs: { 'aria-label': d } }));
  const dayRow = h('div', { className: 'row' }, ...days.map((c, i) => h('label', { className: 'check' }, c, DAYS[i])));
  const week = select('Which week', [...WEEKS, ['date', 'Date']]);
  const weekday = select('Day of the week', DAYS.map((d, i) => [String(i), d] as [string, string]));
  weekday.options[1]!.defaultSelected = true;
  const date = h('input', { type: 'number', min: '1', max: '31', defaultValue: '1', attrs: { 'aria-label': 'Day of the month' } });
  const monthRow = h('div', { className: 'row' }, week, weekday, date);
  const day = h('input', { type: 'date', attrs: { 'aria-label': 'Date' } });
  const deadline = h('input', { type: 'number', min: '5', max: '10080', placeholder: 'Deadline, minutes (optional)', attrs: { 'aria-label': 'Deadline in minutes' } });
  const onceRow = h('div', { className: 'row' }, day, deadline);
  const page = h('input', { type: 'url', placeholder: 'Page to watch, https://…', attrs: { 'aria-label': 'Page to watch' } });
  const every = h('input', { type: 'number', min: '15', max: '1440', defaultValue: '60', attrs: { 'aria-label': 'Minutes between checks' } });
  const onlyIf = h('input', { placeholder: 'Only if a new line has one of these words (optional)', attrs: { 'aria-label': 'Only if' } });
  const eventRow = h('div', { className: 'stack' }, page, h('div', { className: 'row' }, every, onlyIf));
  const nextLine = h('ol', { className: 'muted small', attrs: { 'aria-label': 'Next runs' } });
  // No Ask without a loop model, and Plan first is off without a plan model: the worker refuses them (gardenRun).
  const work = select('Work', [['read', 'Read these pages'], ['mission', 'Run a mission'], ...(ask.ask ? [['ask', 'Ask']] as [string, string][] : [])]);
  const plan = new Option(ask.plan ? 'Plan first' : 'Plan first: needs a model measured for plans', 'plan');
  plan.disabled = !ask.plan;
  work.append(plan);
  const urls = h('textarea', { rows: 2, placeholder: `Pages, one URL per line, on ${g.name}’s sites`, attrs: { 'aria-label': 'Pages, one per line' } });
  const goal = h('textarea', { rows: 2, maxLength: 300, placeholder: 'Goal, e.g. Find this week’s cheapest flight to Lisbon', attrs: { 'aria-label': 'Goal' } });
  const request = h('textarea', { rows: 2, maxLength: 1000, placeholder: 'What should it do?', attrs: { 'aria-label': 'Request' } });
  const picker = mentionPicker();
  // A routine may work for one memory file: its template joins each run (instruction only when you wrote it).
  const forSel = select('Works for', [['', 'For no one in memory'], ...[...S.memory.values()].filter((e) => e.confirmed).map((e): [string, string] => [e.id, `For ${e.name}`])]);
  // A routine may follow a skill (plan or ask work): its method is read at each run, so a better skill improves it.
  const skillSel = select('Skill', []);
  const skillNote = h('span', { className: 'muted small', textContent: 'Not tested yet', hidden: true });
  const skillOptions = () => skillSel.replaceChildren(new Option('No skill', ''), ...S.skills.filter((x) => x.on && (!x.gardenerId || x.gardenerId === g.id)).map((x) => new Option(`Follows /${x.name}`, x.id, false, x.id === skillSel.value)));
  skillOptions();
  skillSel.onfocus = skillOptions;
  const err = errLine();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const words = () => [...new Set(onlyIf.value.split(/[\s,]+/).filter(Boolean))];
  // Raw from the form; parseWhen says whether it is valid (the worker checks it again).
  const when = (): unknown => ({
    every: { kind: 'every', hours: Number(hours.value) },
    daily: { kind: 'daily', at: time.value },
    weekly: { kind: 'weekly', days: days.filter((c) => c.checked).map((c) => Number(c.value)), at: time.value },
    monthly: { kind: 'monthly', on: week.value === 'date' ? { date: Number(date.value) } : { week: Number(week.value), day: Number(weekday.value) }, at: time.value },
    once: { kind: 'once', date: day.value, at: time.value, ...(deadline.value && { deadline: Number(deadline.value) }) },
    event: { kind: 'event', url: page.value.trim(), every: Number(every.value), ...(words().length && { onlyIf: words() }) },
  })[kind.value];
  const update = () => {
    hours.hidden = kind.value !== 'every';
    time.hidden = kind.value === 'every' || kind.value === 'event';
    dayRow.hidden = kind.value !== 'weekly';
    monthRow.hidden = kind.value !== 'monthly';
    weekday.hidden = week.value === 'date';
    date.hidden = week.value !== 'date';
    onceRow.hidden = kind.value !== 'once';
    eventRow.hidden = kind.value !== 'event';
    urls.hidden = work.value !== 'read';
    goal.hidden = work.value !== 'mission';
    request.hidden = picker.el.hidden = askNow.hidden = skillSel.hidden = work.value !== 'ask' && work.value !== 'plan';
    const linked = S.skills.find((x) => x.id === skillSel.value);
    skillNote.hidden = skillSel.hidden || !linked || tested(linked);
    const w = parseWhen(when());
    nextLine.replaceChildren(...(w ? nextRuns(w, tz, Date.now()) : []).map((t) => h('li', { textContent: at(t) })));
  };
  // Ask now: a run by hand, with the named tabs as they are now (the same tab, on the same page).
  const askNow = busyButton('Ask now', tryIt(err, async () => {
    await bg('gardenRun', { gardenerId: g.id, work: { kind: work.value, request: request.value.trim(), tabs: picker.picked() } });
    picker.clear();
  }), 'secondary');
  askNow.type = 'button';
  const form = h('form', { className: 'stack', oninput: update }, name, h('div', { className: 'row' }, kind, hours, time), dayRow, monthRow, onceRow, eventRow, nextLine, work, urls, goal, request, picker.el, h('div', { className: 'row' }, skillSel, skillNote), forSel, err,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: 'Add routine' }), askNow));
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    // A routine keeps the named tabs' URLs and finds a tab on each exactly, each run.
    const w: Work = work.value === 'read' ? { kind: 'read', urls: lines(urls.value) } : work.value === 'mission' ? { kind: 'mission', goal: goal.value.trim() }
      : { kind: work.value === 'plan' ? 'plan' : 'ask', request: request.value.trim(), tabs: picker.picked() };
    try {
      await bg('routineSave', { routine: { gardenerId: g.id, name: name.value.trim(), when: when(), work: w, ...(forSel.value && { for: forSel.value }), ...(!skillSel.hidden && skillSel.value && { skillId: skillSel.value }) } });
      form.reset();
      picker.clear();
      update();
      routineForms.get(g.id)?.removeAttribute('open');
      await renderGarden();
    } catch (x) {
      fail(err, x);
    }
  };
  update();
  return form;
}

/**
 * "Tabs it may read": the person's open web pages, picked one by one. Each keeps its URL (and tab) as it was when
 * picked; the gardener only ever reads these, never acts in them.
 */
function mentionPicker(): { el: HTMLDetailsElement; picked: () => Mention[]; clear: () => void } {
  const list = h('div', { className: 'stack' });
  const el = h('details', {}, h('summary', { textContent: 'Tabs it may read' }),
    h('p', { className: 'muted small', textContent: 'Up to 5. It reads them as they are, signed in, and never clicks or types in them.' }), list);
  const refresh = async () => {
    const keep = new Set(picked().map((m) => m.tabId));
    const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ''));
    list.replaceChildren(...(tabs.length ? tabs.map((t) => {
      const box = h('input', { type: 'checkbox', defaultChecked: keep.has(t.id), attrs: { 'aria-label': t.title || t.url || '' } }) as HTMLInputElement & { mention?: Mention };
      box.mention = { url: t.url!, title: (t.title ?? '').slice(0, 200), tabId: t.id! };
      return h('label', { className: 'check', title: t.url ?? '' }, box, t.title || t.url || '');
    }) : [h('span', { className: 'muted small', textContent: 'No web pages are open.' })]));
  };
  function picked(): Mention[] {
    return [...list.querySelectorAll<HTMLInputElement & { mention?: Mention }>('input:checked')].flatMap((b) => (b.mention ? [b.mention] : [])).slice(0, 5);
  }
  el.ontoggle = () => void (el.open && refresh());
  return { el, picked, clear: () => (list.replaceChildren(), (el.open = false)) };
}
