// Skills: a method the person wrote, run by /name, by a routine, or on its test cases.
import { $, busyButton, button, emptyPot, errLine, labelled, tryIt } from './shell.ts';
import { h } from '../ui/dom.ts';
import { diffText } from '../domain/compare.ts';
import { isWorking } from '../domain/garden/records.ts';
import { EDIT_OFF, NEEDS, tested, type Evidence, type Skill, type SkillCase, type SkillFile } from '../domain/garden/skills.ts';
import { bg } from '../shared/protocol.ts';
import { at, count, lacks, lines, renderGarden, runs, S, select } from './garden-state.ts';

const casesText = (cs: SkillCase[]) => cs.map((c) => (c.expect ? `${c.input} => ${c.expect}` : c.input)).join('\n');
const casesOf = (text: string) => lines(text).map((l) => {
  const [input, expect] = l.split(/\s*=>\s*/, 2);
  return { input: input!.trim(), ...(expect?.trim() && { expect: expect.trim() }) };
});
const reloadSkills = async () => ((S.skills = await bg<Skill[]>('skillList')), renderSkills());

export function renderSkills(): void {
  $('#garden-skills').replaceChildren(
    h('p', { className: 'muted small', textContent: 'A skill is a method you write once. Type /name in chat or in a request, or let a routine follow it.' }),
    h('ul', { className: 'list' }, ...(S.skills.length ? S.skills.map(skillItem) : [emptyPot('No skills yet.')])),
    h('details', {}, h('summary', { textContent: 'Add a skill' }), skillForm(null)));
}

function skillItem(s: Skill): HTMLLIElement {
  const err = errLine();
  const passed = s.cases.filter((c) => c.pass).length;
  const blocked = lacks(s);
  const status = blocked ? NEEDS : !s.on ? (s.by === 'person' ? 'Off' : s.by === 'preset' ? 'Off: from the pack. Turn on?' : `Off: by ${s.by}. Turn on?`) : !s.cases.length ? 'No test cases' : tested(s) ? `${passed} of ${s.cases.length} cases passed` : 'Not tested yet';
  const owner = S.gardeners.find((x) => x.id === s.gardenerId)?.name;
  const who = s.gardenerId ? null : select('Test with', S.gardeners.map((x): [string, string] => [x.id, x.name]));
  const approve = h('input', { type: 'checkbox', attrs: { 'aria-label': 'Approve plans for this test' } });
  return h('li', { className: 'skill' },
    h('span', { className: 't' }, h('b', { textContent: `/${s.name}` }),
      h('span', { className: 'p', textContent: [s.title, s.work === 'plan' ? 'plans' : 'asks', `v${s.version}`, ...(owner ? [owner] : [])].join(' · ') }),
      h('span', { className: 'result', textContent: status }), err),
    h('div', { className: 'actions' },
      !(blocked && !s.on) && labelled(busyButton(s.on ? 'Turn off' : 'Turn on', tryIt(err, async () => (await bg('skillSave', { skill: { ...s, on: !s.on } }), await reloadSkills())), 'ghost'), `${s.on ? 'Turn off' : 'Turn on'} /${s.name}`),
      !blocked && labelled(busyButton('Test on cases', tryIt(err, async () => (await bg('skillTest', { id: s.id, gardenerId: who?.value, approvePlans: approve.checked }), await reloadSkills())), 'secondary'), `Test /${s.name} on its cases`),
      labelled(busyButton('Delete', tryIt(err, async () => {
        const linked = S.routines.filter((r) => r.skillId === s.id).length;
        if (!confirm(`Delete /${s.name}?${linked ? ` ${count(linked, 'routine')} that follow it will pause.` : ''}`)) return;
        await bg('skillDelete', { id: s.id });
        await renderGarden();
      }), 'ghost'), `Delete /${s.name}`)),
    h('div', { className: 'row' }, who, h('label', { className: 'check' }, approve, 'Approve plans for this test (non-sensitive steps only)')),
    casesBox(s, err), improveBox(s), historyBox(s),
    h('details', {}, h('summary', { textContent: 'Edit' }), skillForm(s)));
}

/** Each case's last test: passed or failed by `expect` (code); without one, the person marks it. */
function casesBox(s: Skill, err: HTMLElement): HTMLElement | null {
  if (!s.cases.length) return null;
  return h('details', {}, h('summary', { textContent: `Cases (${s.cases.length})` }), h('ul', { className: 'list' }, ...s.cases.map((c, k) => {
    const r = c.runId ? runs.get(c.runId) : undefined;
    const ended = !!c.runId && (!r || !isWorking(r)); // a pruned run has ended
    const state = c.pass === true ? 'Passed' : c.pass === false ? 'Failed' : !c.runId ? 'Not run' : !ended ? 'Running…' : 'Did it pass?';
    const mark = (pass: boolean) => labelled(busyButton(pass ? 'Pass' : 'Fail', tryIt(err, async () => (await bg('skillMark', { id: s.id, k, pass }), await reloadSkills())), 'ghost'), `Mark case ${k + 1} ${pass ? 'passed' : 'failed'}`);
    return h('li', {}, h('span', { className: 't' }, h('span', { className: 'result', textContent: c.input }),
      h('span', { className: 'p', textContent: `${c.expect ? `expects “${c.expect}” · ` : ''}${state}` }),
      r && ended && h('span', { className: 'muted small result', textContent: (r.answer ?? r.why ?? '').slice(0, 400) })),
    ...(ended && c.pass === undefined && (!c.expect || !r) ? [mark(true), mark(false)] : []));
  })));
}

/** What went wrong, and a proposed edit (only with a model measured for skill edits) shown as a diff, off until accepted. */
function improveBox(s: Skill): HTMLDetailsElement {
  const err = errLine();
  const list = h('ul', { className: 'list' });
  const box = h('details', {}, h('summary', { textContent: s.proposed ? 'Improve: an edit is proposed' : 'Improve' }), list,
    s.proposed ? h('div', { className: 'stack' },
      h('p', { className: 'muted small', textContent: `Proposed: ${s.proposed.why}. Lines with + are added, − removed.` }),
      h('pre', { className: 'result small', textContent: diffText(s.method, s.proposed.method) }),
      h('div', { className: 'row' },
        busyButton('Accept', tryIt(err, async () => (await bg('skillAccept', { id: s.id, accept: true }), await reloadSkills())), 'primary'),
        busyButton('Discard', tryIt(err, async () => (await bg('skillAccept', { id: s.id, accept: false }), await reloadSkills())), 'ghost')))
      : S.abilities.skillEdit ? busyButton('Suggest an edit', tryIt(err, async () => (await bg('skillPropose', { id: s.id }), await reloadSkills())), 'secondary')
        : h('p', { className: 'muted small', textContent: `${EDIT_OFF} Edit the method by hand, with what went wrong beside it.` }),
    err);
  box.ontoggle = async () => {
    if (!box.open) return;
    const ev = await bg<Evidence[]>('skillEvidence', { id: s.id }).catch(() => []);
    const kind = { down: 'Not helpful', correction: 'Corrected', case: 'Failed test' } as const;
    list.replaceChildren(...(ev.length ? ev.map((e) => h('li', {}, h('span', { className: 't' }, h('b', { className: 'small', textContent: `${kind[e.kind]}: ${e.input.slice(0, 120)}` }),
      e.note && h('span', { className: 'p', textContent: e.note }), h('span', { className: 'muted small result', textContent: e.answer.slice(0, 600) }))))
      : [emptyPot('Nothing has gone wrong yet.')]));
  };
  return box;
}

function historyBox(s: Skill): HTMLDetailsElement {
  return h('details', {}, h('summary', { textContent: `History (${s.history.length})` }), h('ul', { className: 'list' }, ...[...s.history].reverse().map((v) =>
    h('li', {}, h('span', { className: 't' }, h('b', { className: 'small', textContent: `v${v.version} · ${at(v.at)} · ${v.why}` }), h('span', { className: 'muted small result', textContent: v.method }))))));
}

/** A new skill, or an edit (a changed method is a new version). Files are data: text files, up to 5. */
function skillForm(s: Skill | null): HTMLFormElement {
  const name = h('input', { placeholder: 'Command, e.g. brief', required: true, pattern: '[a-z0-9-]{2,30}', defaultValue: s?.name ?? '', attrs: { 'aria-label': 'Skill command' } });
  const title = h('input', { placeholder: 'Title, e.g. Decision brief', required: true, maxLength: 80, defaultValue: s?.title ?? '', attrs: { 'aria-label': 'Skill title' } });
  const work = select('Skill work', [['plan', 'Plan first'], ['ask', 'Ask']]);
  work.value = s?.work ?? 'plan';
  const owner = select('Skill gardener', [['', 'Any gardener'], ...S.gardeners.map((x): [string, string] => [x.id, x.name])]);
  owner.value = s?.gardenerId ?? '';
  const method = h('textarea', { rows: 4, required: true, maxLength: 6000, placeholder: 'How to do it, step by step', defaultValue: s?.method ?? '', attrs: { 'aria-label': 'Method' } });
  const cases = h('textarea', { rows: 3, placeholder: 'Test cases, one per line: request => words the answer must hold (optional)', defaultValue: casesText(s?.cases ?? []), attrs: { 'aria-label': 'Test cases' } });
  let files: SkillFile[] = s?.files ?? [];
  const fileList = h('ul', { className: 'list' });
  const showFiles = (): void => fileList.replaceChildren(...files.map((f) => h('li', {}, h('span', { className: 't', textContent: `${f.name} (${f.text.length} characters)` }),
    labelled(button('×', (): void => ((files = files.filter((x) => x !== f)), showFiles()), 'ghost'), `Remove ${f.name}`))));
  const pick = h('input', { type: 'file', multiple: true, accept: 'text/*,.md,.csv,.json', attrs: { 'aria-label': 'Add files' } });
  pick.onchange = async () => {
    for (const f of [...(pick.files ?? [])]) files = [...files, { name: f.name.slice(0, 120), text: (await f.text()).slice(0, 20_000) }].slice(0, 5);
    pick.value = '';
    showFiles();
  };
  showFiles();
  const err = errLine();
  const form = h('form', { className: 'stack' }, h('div', { className: 'row' }, name, title), h('div', { className: 'row' }, work, owner), method,
    h('label', { className: 'muted small' }, 'Files it reads as data (up to 5) ', pick), fileList, cases, err,
    h('div', { className: 'row' }, h('button', { className: 'primary', textContent: s ? 'Save skill' : 'Add skill' })));
  form.onsubmit = (e) => {
    e.preventDefault();
    void tryIt(err, async () => {
      await bg('skillSave', { skill: { ...(s && { id: s.id, on: s.on }), name: name.value.trim(), title: title.value.trim(), work: work.value, method: method.value, files, cases: casesOf(cases.value), ...(owner.value && { gardenerId: owner.value }) } });
      await reloadSkills();
    })();
  };
  return form;
}
