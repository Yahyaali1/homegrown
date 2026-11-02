// Outputs: the zip writer, the PPTX parts, the evidence check, chart scale, model-free decks and passages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzip, zipWrite, crc32 } from '../../src/domain/zip.ts';
import { pptx, hex } from '../../src/domain/pptx.ts';
import { moveCited } from '../../src/domain/research.ts';
import { scale, numericColumns } from '../../src/ui/chart.ts';
import { deckFromBrief, deckFromTable, fontStack, parseArtifact, parseCell, parseBrand, parseDeck } from '../../src/domain/outputs.ts';
import { filePassages, keepCited } from '../../src/domain/reading.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = async (z: ReturnType<typeof unzip>, name: string) => new TextDecoder().decode(await z[name]!());

test('zipWrite output reads back byte-for-byte, with our unzip and the system one', async () => {
  const bin = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 256);
  const entries = [{ name: 'a.txt', data: bytes('hello') }, { name: 'dir/b.bin', data: bin }, { name: 'ünï.xml', data: bytes('<x/>') }];
  const zip = zipWrite(entries);
  const z = unzip(zip.slice().buffer);
  for (const e of entries) assert.deepEqual(await z[e.name]!(), e.data);
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-zip-'));
  fs.writeFileSync(path.join(dir, 'x.zip'), zip);
  execFileSync('unzip', ['-tq', path.join(dir, 'x.zip')]); // checks every CRC; throws on a bad one
  assert.deepEqual(new Uint8Array(execFileSync('unzip', ['-p', path.join(dir, 'x.zip'), 'dir/b.bin'])), bin);
});

test('a PPTX has its content types, the presentation and one slide part per slide, with a picture for a chart', async () => {
  const deck = { slides: [{ title: 'Ferns', bullets: [] }, { title: 'Prices', bullets: ['Boston £12'] }, { title: 'Chart', bullets: [] }] };
  const z = unzip(pptx(deck, [undefined, undefined, { png: bytes('PNG'), width: 4, height: 2 }]).slice().buffer);
  for (const p of ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/media/image3.png']) assert.ok(z[p], p);
  assert.deepEqual(Object.keys(z).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(), ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml']);
  assert.match(await text(z, '[Content_Types].xml'), /slide3\.xml/);
  assert.equal((await text(z, 'ppt/presentation.xml')).match(/<p:sldId /g)?.length, 3);
  assert.match(await text(z, 'ppt/slides/_rels/slide3.xml.rels'), /media\/image3\.png/);
  assert.doesNotMatch(await text(z, 'ppt/slides/_rels/slide1.xml.rels'), /image/);
});

test('XML special characters in slide text are escaped', async () => {
  const z = unzip(pptx({ slides: [{ title: 'A & B <c> "d"', bullets: ["it's </a:t><evil/>"] }] }, [], { bg: 'rgb(1, 2, 3)', font: '"Inter", sans-serif' }).slice().buffer);
  const slide = await text(z, 'ppt/slides/slide1.xml');
  assert.match(slide, /A &#38; B &#60;c&#62; &#34;d&#34;/);
  assert.doesNotMatch(slide, /<evil\/>/);
  assert.match(slide, /val="010203"/);
  assert.match(slide, /typeface="Inter"/);
  assert.equal(hex('#abc', 'X'), 'AABBCC');
  assert.equal(hex('url(x)', 'FFFFFF'), 'FFFFFF');
});

test('a cited line under Assumptions moves to Evidence; uncited lines stay', () => {
  const report = 'Answer.\n\n## Evidence\n- Ferns like shade [1].\n\n## Assumptions\n- Most homes are dry.\n- Moss grows fast [2].\n';
  const out = moveCited(report);
  const [evidence, assumptions] = out.split('## Assumptions');
  assert.match(evidence!, /Moss grows fast \[2\]/);
  assert.doesNotMatch(assumptions!, /\[\d+\]/);
  assert.match(assumptions!, /Most homes are dry/);
  assert.equal(moveCited('No sections [1].'), 'No sections [1].');
  assert.match(moveCited('## Assumptions\n- Cited [3].'), /## Evidence\n- Cited \[3\]\.[\s\S]*## Assumptions/);
});

test('chart scale holds 0 and handles negatives and a single row', () => {
  assert.deepEqual(scale([-5, 10]), { lo: -5, hi: 10 });
  assert.deepEqual(scale([-3, -1]), { lo: -3, hi: 0 });
  assert.deepEqual(scale([7]), { lo: 0, hi: 7 });
  assert.deepEqual(scale([0]), { lo: 0, hi: 1 });
  assert.deepEqual(numericColumns({ columns: ['name', 'price', 'note'], rows: [['a', 1, 'x'], ['b', null, '2']] }), [1]);
});

test('without the deck ability, a brief with 3 ## headings gives 4 slides with its bullets as written', () => {
  const deck = deckFromBrief('Ferns', 'Intro line.\n## Light\n- Shade\n- Indirect sun\n## Water\nKeep moist.\n## Price\n1. £12');
  assert.equal(deck.slides.length, 4);
  assert.deepEqual(deck.slides.map((s) => s.title), ['Ferns', 'Light', 'Water', 'Price']);
  assert.deepEqual(deck.slides[1]!.bullets, ['Shade', 'Indirect sun']);
  assert.deepEqual(deck.slides[0]!.bullets, ['Intro line.']);
  const t = { columns: ['month', 'sales'], rows: [['Jan', 3]] };
  assert.deepEqual(deckFromTable('Sales', t).slides[1]!.chart, t);
});

test('a model deck parses only as JSON slides (≤ 15) and never carries a chart', () => {
  assert.equal(parseDeck('no json'), null);
  assert.equal(parseDeck(JSON.stringify({ slides: Array.from({ length: 16 }, () => ({ title: 't', bullets: [] })) })), null);
  const d = parseDeck('Here: {"slides": [{"title": "A", "bullets": ["b", 3], "chart": {"columns": ["x"], "rows": []}}]}');
  assert.deepEqual(d, { slides: [{ title: 'A', bullets: ['b'] }] });
});

test('artifacts parse by kind; a bad brand colour or a newer v is refused', () => {
  const brand = { site: 'x.com', bg: 'rgb(255, 255, 255)', text: '#111', link: 'rgb(0, 0, 238)', button: 'rgb(0,0,0)', buttonText: '#fff', font: 'Inter, sans-serif', headingFont: 'Inter', logo: 'javascript:alert(1)' };
  const a = parseArtifact({ v: 1, id: 'b', kind: 'brand', title: 'x.com', at: 1, data: brand });
  assert.ok(a && a.kind === 'brand' && !a.data.logo);
  assert.equal(parseArtifact({ v: 1, id: 'b', kind: 'brand', title: 'x', at: 1, data: { ...brand, bg: 'url(https://evil)' } }), null);
  assert.equal(parseArtifact({ v: 2, id: 't', kind: 'table', title: 't', at: 1, data: { columns: [], rows: [] } }), null);
  assert.deepEqual(parseArtifact({ v: 1, id: 't', kind: 'table', title: 't', at: 1, data: { columns: ['a'], rows: [[{}], [2, 3]] } })?.data, { columns: ['a'], rows: [['[object Object]'], [2]] });
});

test('without cite, 3 PDFs give passages from each file, labelled by page, and no model call', () => {
  const files = [
    { name: 'a.pdf', pages: ['Cover page.', 'The Boston fern costs twelve pounds at the garden shop.'] },
    { name: 'b.pdf', pages: ['Ferns need shade and the Boston fern needs weekly water.'] },
    { name: 'c.pdf', pages: ['Unrelated tractor manual.', 'Our Boston fern sold out in May.'] },
  ];
  const ps = filePassages(files, 'What about the Boston fern?');
  assert.deepEqual([...new Set(ps.map((p) => p.file))], ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.deepEqual(ps.map((p) => `${p.file} p.${p.page}`), ['a.pdf p.2', 'b.pdf p.1', 'c.pdf p.2']);
  // A citation whose page doesn't hold the words is dropped; a held one stays.
  const { text: kept, dropped } = keepCited('The Boston fern costs twelve pounds [a.pdf p.2]. Ferns grow on the moon [b.pdf p.1].', files);
  assert.equal(dropped, 1);
  assert.match(kept, /twelve pounds \[a\.pdf p\.2\]/);
  assert.doesNotMatch(kept, /\[b\.pdf p\.1\]/);
  // A label after the full stop cites that sentence.
  assert.deepEqual(keepCited('Ferns grow on the moon. [a.pdf p.2] The Boston fern costs twelve pounds. [a.pdf p.2]', files),
    { text: 'Ferns grow on the moon. The Boston fern costs twelve pounds [a.pdf p.2].', dropped: 1 });
});

test('font stacks keep non-ASCII names, drop other characters and cut long stacks at a family', () => {
  assert.equal(fontStack('"Noto Sans JP", "ヒラギノ角ゴ", sans-serif; x{}'), '"Noto Sans JP", "ヒラギノ角ゴ", sans-serif x');
  const long = Array.from({ length: 30 }, (_, i) => `Family Number ${i}`).join(', ');
  const cut = fontStack(long);
  assert.ok(cut.length <= 200 && cut.endsWith(`Number ${cut.split(', ').length - 1}`));
  const b = { site: 's', bg: '#fff', text: '#000', link: '#00f', button: '#000', buttonText: '#fff', font: fontStack('"ヒラギノ", sans-serif'), headingFont: fontStack(long) };
  assert.ok(parseBrand(b));
});

test('edited cells: numbers become numbers, codes with leading zeros stay text', () => {
  assert.equal(parseCell('42'), 42);
  assert.equal(parseCell('-0.5'), -0.5);
  assert.equal(parseCell('007'), '007');
  assert.equal(parseCell(' '), null);
});

test('PPTX text drops U+FFFE and U+FFFF, which XML forbids', async () => {
  const z = unzip(pptx({ slides: [{ title: 'a\uFFFEb\uFFFFc', bullets: [] }] }).slice().buffer);
  assert.match(await text(z, 'ppt/slides/slide1.xml'), /<a:t>abc<\/a:t>/);
});
