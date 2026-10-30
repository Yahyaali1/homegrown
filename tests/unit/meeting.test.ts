// Meetings (plan T10): lines merged by time, notes owners grounded in the transcript, call hosts, doc pieces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkItem, isMeetingHost, itemsOf, meetingName, meetingPath, mergeLines, mergeNotes, notesBody, parseNotes, pieces, timeParts, transcriptOf, type Line } from '../../src/domain/meeting.ts';
import { docRefused } from '../../src/domain/memory.ts';

test('mergeLines orders You and Them by time and joins one speaker’s short gaps', () => {
  const lines: Line[] = [
    { who: 'Them', at: 20_000, end: 40_000, text: 'Can you send the deck?' },
    { who: 'You', at: 0, end: 20_000, text: 'Hi all.' },
    { who: 'You', at: 41_000, end: 60_000, text: 'Yes,' },
    { who: 'You', at: 61_000, end: 80_000, text: 'by Friday.' },
    { who: 'You', at: 90_000, end: 100_000, text: 'Anything else?' },
  ];
  const m = mergeLines(lines);
  assert.deepEqual(m.map((l) => [l.who, l.text]), [['You', 'Hi all.'], ['Them', 'Can you send the deck?'], ['You', 'Yes, by Friday.'], ['You', 'Anything else?']]);
  assert.equal(transcriptOf(m), '[0:00] You: Hi all.\n[0:20] Them: Can you send the deck?\n[0:41] You: Yes, by Friday.\n[1:30] You: Anything else?');
  assert.equal(transcriptOf([{ at: 5000, end: 9000, text: 'A file line.' }]), '[0:05] A file line.', 'a file has no speaker');
});

test('parseNotes drops an owner the transcript doesn’t name; "You" is the mic side; "Them" is no owner', () => {
  const t = '[0:00] You: Maja will draft the brief.\n[0:20] Them: I can review it.';
  const n = parseNotes({ summary: 'Brief planning.', decisions: ['Ship in May', 3], actions: [
    { item: 'Draft the brief', owner: 'Maja' }, { item: 'Review', owner: 'Tom' }, { item: 'Book room', owner: 'you' }, { item: 'Call', owner: 'Them' }, { owner: 'Maja' },
  ] }, t)!;
  assert.deepEqual(n.decisions, ['Ship in May']);
  assert.deepEqual(n.actions, [{ item: 'Draft the brief', owner: 'Maja' }, { item: 'Review' }, { item: 'Book room', owner: 'You' }, { item: 'Call' }]);
  assert.equal(parseNotes({ decisions: [] }, t), null, 'no summary');
  assert.equal(parseNotes(null, t), null);
  assert.deepEqual(parseNotes({ summary: 'x', actions: [{ item: 'a', owner: 'Maj' }] }, t)!.actions, [{ item: 'a' }], 'whole names only');
});

test('call hosts: us02web.zoom.us and meet.google.com match; zoom.us.evil.io and notmeet.google.com don’t', () => {
  for (const h of ['us02web.zoom.us', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'zoom.us']) assert.ok(isMeetingHost(h), h);
  for (const h of ['zoom.us.evil.io', 'notmeet.google.com', 'evilzoom.us', 'google.com']) assert.ok(!isMeetingHost(h), h);
});

test('a long transcript becomes doc pieces of at most 20 000 chars, cut at line ends; paths stay under Meetings/', () => {
  const text = Array.from({ length: 900 }, (_, i) => `[${i}:00] You: ${'word '.repeat(10)}`).join('\n');
  const p = pieces(text);
  assert.ok(p.length > 1 && p.every((x) => x.length <= 20_000));
  assert.equal(p.join('\n'), text);
  const name = meetingName(new Date(2026, 9, 30, 14, 5), 'Weekly / sync');
  assert.equal(name, '2026-10-30 14:05 Weekly sync');
  assert.equal(meetingPath(name, 2), 'Meetings/2026-10-30 14:05 Weekly sync (part 2).md');
  assert.ok(docRefused(meetingPath(name)), 'a gardener can’t write a meeting');
});

test('notes: 20-minute parts, merged in code, action items as a checklist that can be ticked', () => {
  const parts = timeParts([{ at: 0, end: 1, text: 'a' }, { at: 19 * 60_000, end: 1, text: 'b' }, { at: 41 * 60_000, end: 1, text: 'c' }]);
  assert.deepEqual(parts.map((p) => p.map((l) => l.text)), [['a', 'b'], ['c']]);
  const n = mergeNotes([{ summary: 'One.', decisions: ['Go'], actions: [{ item: 'Send deck', owner: 'You' }] }, { summary: 'Two.', decisions: ['go'], actions: [{ item: 'Book room' }] }]);
  const body = notesBody(n);
  assert.match(body, /## Summary\nOne\. Two\./);
  assert.deepEqual(itemsOf(body), [{ done: false, text: 'Send deck — You' }, { done: false, text: 'Book room' }]);
  assert.deepEqual(itemsOf(checkItem(body, 1, true)).map((i) => i.done), [false, true]);
});

test('the saved transcript says how many windows failed; leaving the call’s host stops the recording', async () => {
  const { meetingText, leftCall } = await import('../../src/domain/meeting.ts');
  assert.equal(meetingText([], 2), '(2 windows of 20 s could not be transcribed.)\n(No speech was heard.)');
  assert.equal(meetingText([{ who: 'You', at: 0, end: 1, text: 'Hi.' }]), '[0:00] You: Hi.');
  assert.equal(leftCall('meet.google.com', 'https://meet.google.com/abc?x=1'), false);
  assert.equal(leftCall('meet.google.com', 'https://www.google.com/'), true);
  assert.equal(leftCall('meet.google.com', 'chrome://newtab/'), true);
  assert.equal(leftCall('meet.google.com', undefined), false, 'no URL change');
});

test('ask across meetings keeps the newest meetings’ chunks and counts the meetings left out', async () => {
  const { newestChunks } = await import('../../src/domain/meeting.ts');
  const docs = [
    { id: 'a', path: 'Meetings/Old.md', at: 1 },
    { id: 'b', path: 'Meetings/New.md', at: 3 },
    { id: 'c', path: 'Meetings/New (part 2).md', at: 3 },
    { id: 'd', path: 'Meetings/Mid.md', at: 2 },
  ];
  const r = newestChunks(docs, 3, (d) => [`${d.id}1`, `${d.id}2`]);
  assert.deepEqual(r.items, ['b1', 'b2', 'c1']);
  assert.equal(r.left, 2, 'Mid and Old');
});

test('a file over 100 MB or 2 hours is refused before it is transcribed', async () => {
  const { fileRefused } = await import('../../src/domain/meeting.ts');
  assert.equal(fileRefused(1 << 20, 60_000), null);
  assert.match(fileRefused(101 << 20)!, /100 MB/);
  assert.match(fileRefused(1, 3 * 3600_000)!, /2 hours/);
});
