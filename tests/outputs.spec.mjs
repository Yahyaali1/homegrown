// Outputs (plan T9): a table artifact is edited, shown as a chart and exported as PNG and PPTX (checked with the
// system unzip); a brief and a table become decks with no model; 3 PDFs in the reader give passages from each file.
// No model for the first two; the PDFs run @slow in the model profile, since a model measured for `cite` would answer.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, engine, serve, ROOT, EXT } from './harness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-outputs-'));
const bgOn = async (page, cmd, args = {}) => {
  const r = await page.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
};

test.describe('no model', () => {
  let ctx, id, page;
  test.beforeAll(async () => {
    ({ ctx, id } = await launch());
    page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/outputs.html`);
  });
  test.afterAll(async () => ctx?.close());

  test('a table artifact is edited, toggles to a chart, and exports PNG and PPTX; Make deck builds one with no model', async () => {
    const a = await bgOn(page, 'artifactSave', { artifact: { kind: 'table', title: 'Fern sales', data: { columns: ['month', 'sales', 'returns'], rows: [['Jan', 12, -2], ['Feb', 30, -1], ['Mar', 18, 0]] } } });
    await page.goto(`chrome-extension://${id}/outputs.html?id=${a.id}`);
    await expect(page.locator('#title')).toHaveText('Table: Fern sales');

    // Edit in place, add and delete a row: each change is saved to the artifact.
    await page.getByLabel('sales in row 2').fill('31');
    await page.getByLabel('sales in row 2').press('Tab');
    await page.getByRole('button', { name: '+ Add row' }).click();
    await page.getByLabel('month in row 4').fill('Apr');
    await page.getByLabel('month in row 4').press('Tab');
    await expect.poll(async () => (await bgOn(page, 'artifactGet', { id: a.id })).data.rows, { timeout: 5000 }).toEqual([['Jan', 12, -2], ['Feb', 31, -1], ['Mar', 18, 0], ['Apr', null, null]]);
    await page.locator('tbody tr').nth(3).getByRole('button', { name: '×' }).click();
    await expect.poll(async () => (await bgOn(page, 'artifactGet', { id: a.id })).data.rows.length, { timeout: 5000 }).toBe(3);

    // Chart ↔ Table: bars with KPI cards; the choice is saved as the artifact's kind.
    await page.getByRole('button', { name: 'Bars' }).click();
    await expect(page.locator('.chart svg rect')).not.toHaveCount(0);
    await expect(page.locator('.kpi')).toHaveCount(2);
    await expect(page.locator('.chart svg')).toContainText('returns');
    await expect.poll(async () => (await bgOn(page, 'artifactGet', { id: a.id })).kind, { timeout: 5000 }).toBe('chart');
    await page.getByRole('button', { name: 'Line' }).click();
    await expect(page.locator('.chart svg polyline')).toHaveCount(2);

    const png = await save(page, 'PNG');
    expect([...fs.readFileSync(png).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const pptx = await save(page, 'PPTX');
    execFileSync('unzip', ['-tq', pptx]); // every CRC checks
    const names = execFileSync('unzip', ['-Z1', pptx]).toString().split('\n');
    for (const n of ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/media/image2.png']) expect(names).toContain(n);
    expect(execFileSync('unzip', ['-p', pptx, 'ppt/slides/slide1.xml']).toString()).toContain('Fern sales');

    // No model has `deck`: code builds a title slide and the chart slide.
    await page.getByRole('button', { name: 'Make deck' }).click();
    await expect(page.locator('#title')).toHaveText('Deck: Fern sales');
    await expect(page.locator('.slide')).toHaveCount(2);
    await expect(page.locator('.slide').nth(1).locator('svg')).toHaveCount(1);
    execFileSync('unzip', ['-tq', await save(page, 'PPTX')]);
  });

  test('a brief with 3 headings makes a 4-slide deck and a one-pager; a brand kit restyles the deck; every kind is listed', async () => {
    const brief = await bgOn(page, 'artifactSave', { artifact: { kind: 'brief', title: 'Ferns', data: { md: 'Ferns at a glance.\n## Light\n- Shade\n## Water\n- Weekly <b>not</b> daily\n## Price\n- £12' } } });
    const brand = await bgOn(page, 'artifactSave', { artifact: { kind: 'brand', title: 'moss.test', data: { site: 'moss.test', bg: 'rgb(10, 40, 20)', text: 'rgb(240, 240, 230)', link: 'rgb(200, 220, 120)', button: 'rgb(200, 220, 120)', buttonText: 'rgb(0, 0, 0)', font: 'Georgia, serif', headingFont: 'Georgia, serif' } } });
    await page.goto(`chrome-extension://${id}/outputs.html?id=${brief.id}`);
    await expect(page.locator('article.brief')).toContainText('Light');
    await expect(page.locator('article.brief')).toContainText('Weekly <b>not</b> daily'); // escaped, not markup
    await page.getByRole('button', { name: 'Make deck' }).click();
    await expect(page.locator('.slide')).toHaveCount(4);
    await expect(page.locator('.slide h2')).toHaveText(['Ferns', 'Light', 'Water', 'Price']);
    await page.getByLabel('Brand kit').selectOption(brand.id);
    await expect(page.locator('.slide').first()).toHaveCSS('background-color', 'rgb(10, 40, 20)');
    const deckId = new URL(page.url()).searchParams.get('id');
    await expect.poll(async () => (await bgOn(page, 'artifactGet', { id: deckId })).data.brandId).toBe(brand.id);
    const slide = execFileSync('unzip', ['-p', await save(page, 'PPTX'), 'ppt/slides/slide2.xml']).toString();
    expect(slide).toContain('0A2814'); // the brand's background
    expect(slide).toContain('Georgia');

    await page.goto(`chrome-extension://${id}/outputs.html?id=${brief.id}`);
    await page.getByRole('button', { name: 'One-pager' }).click();
    await expect(page.locator('#title')).toHaveText('One-pager: Ferns');
    await page.goto(`chrome-extension://${id}/outputs.html`);
    for (const kind of ['Brief', 'Deck', 'One-pager', 'Brand kit']) await expect(page.locator('ul.items')).toContainText(kind);
    await page.locator('ul.items a', { hasText: 'moss.test' }).click();
    await expect(page.locator('.swatch')).toHaveCount(5);
  });

  test('brand kit from a site: computed colours and fonts, the og:image kept as a data URL, no page text', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'site-'));
    fs.copyFileSync(path.join(ROOT, 'tests/fixtures/red-square.png'), path.join(dir, 'logo.png'));
    fs.writeFileSync(path.join(dir, 'home.html'), '<!doctype html><meta property="og:image" content="/logo.png"><style>body{background:#0a2814;color:oklch(0.95 0 0);font-family:Georgia,serif}a{color:#c8dc78}h1{font-family:Verdana}button{background:#123456;color:#fff}</style><h1>Secret page text</h1><a href="/x">x</a><button>Go</button>');
    const { server, url } = await serve(dir);
    const a = await bgOn(page, 'brandRead', { url: `${url}/home.html` }).finally(() => server.close());
    expect(a.kind).toBe('brand');
    expect(a.data).toMatchObject({ site: '127.0.0.1', bg: 'rgb(10, 40, 20)', link: 'rgb(200, 220, 120)', button: 'rgb(18, 52, 86)', buttonText: 'rgb(255, 255, 255)', font: 'Georgia, serif', headingFont: 'Verdana' });
    expect(a.data.text).toMatch(/^rgb\(2\d\d, 2\d\d, 2\d\d\)$/); // oklch through the canvas pixel
    expect(a.data.logo).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(a)).not.toContain('Secret');
  });
});

test('a deck exports PNG of the whole page with the debugger screenshot (permission granted)', async () => {
  // Chrome asks for the optional permission in a native prompt a test can't click: this copy has it at install.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-dbg-'));
  fs.cpSync(EXT, copy, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
  manifest.permissions.push('debugger');
  fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest));
  const { ctx, id } = await launch({ ext: copy });
  try {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/outputs.html`);
    const slides = Array.from({ length: 6 }, (_, i) => ({ title: `Slide ${i + 1}`, bullets: ['A point'] }));
    const a = await bgOn(page, 'artifactSave', { artifact: { kind: 'deck', title: 'Tall deck', data: { slides } } });
    await page.goto(`chrome-extension://${id}/outputs.html?id=${a.id}`);
    await expect(page.locator('.slide')).toHaveCount(6);
    const png = fs.readFileSync(await save(page, 'PNG'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(20)).toBeGreaterThan(page.viewportSize().height); // the whole page, not the window
  } finally {
    await ctx.close();
  }
});

/** Clicks an export button and returns the downloaded file's path. */
async function save(page, name) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]);
  const file = path.join(tmp, `${Date.now()}-${d.suggestedFilename()}`);
  await d.saveAs(file);
  return file;
}

/** A small text PDF: one line per page, Helvetica. */
function pdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((text, i) => {
    const stream = `BT /F1 11 Tf 40 760 Td (${text}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${out}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test('reader @slow: 3 PDFs give passages from all 3 with no model call; a cited answer only with a model measured for cite', async () => {
  const { ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
  try {
    const files = {
      'ferns.pdf': ['Garden shop catalogue, spring edition.', 'The Boston fern costs twelve pounds and likes shade.'],
      'care.pdf': ['The Boston fern needs water twice a week.'],
      'sales.pdf': ['Tractor parts list.', 'Boston fern sales doubled in May.'],
    };
    for (const [name, pages] of Object.entries(files)) fs.writeFileSync(path.join(tmp, name), pdf(pages));
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/reader.html`);
    await page.locator('#file').setInputFiles(Object.keys(files).map((n) => path.join(tmp, n)));
    await expect(page.locator('section.file')).toHaveCount(3);
    await page.locator('#ask-files-q').fill('What about the Boston fern?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const items = page.locator('.passages li b');
    await expect(items).toHaveText(['ferns.pdf p.2', 'care.pdf p.1', 'sales.pdf p.2']);
    const note = page.locator('#ask-files-out > p.hint');
    await expect(note).not.toHaveText('Writing a cited answer…', { timeout: 5 * 60_000 });
    if ((await note.textContent()).includes('needs a model measured')) {
      expect((await engine(sw, 'status')).loaded).toBeNull(); // nothing was even loaded
      console.log('reader: no model in the catalog is measured for cite, so the cited answer was not run (passages only).');
      return;
    }
    await expect(note.locator('.answer')).toContainText(/\[(ferns|care|sales)\.pdf p\.\d\]/);
  } finally {
    await ctx.close();
  }
});

test('deck @slow: Make deck has a model measured for deck write the slides, else code builds them', async () => {
  const { ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
  try {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/outputs.html`);
    const md = '## Light\n- Boston ferns like bright, indirect light.\n## Water\n- Keep the soil moist but not wet.\n## Feeding\n- Feed once a month from April to September.';
    const brief = await bgOn(page, 'artifactSave', { artifact: { kind: 'brief', title: 'Fern care', data: { md } } });
    const t0 = Date.now();
    const deck = await bgOn(page, 'deckMake', { id: brief.id });
    const loaded = (await engine(sw, 'status')).loaded; // code alone loads no model
    if (!loaded) {
      expect(deck.data.slides.map((s) => s.title)).toEqual(['Fern care', 'Light', 'Water', 'Feeding']);
      console.log('deck: no model in the catalog is measured for deck, so code built it (the model part was not run).');
      return;
    }
    console.log(`deck by ${loaded.name}: ${deck.data.slides.length} slides in ${Date.now() - t0} ms: ${deck.data.slides.map((s) => s.title).join(' | ')}`);
    expect(deck.data.slides.length).toBeGreaterThan(1);
    expect(deck.data.slides.length).toBeLessThanOrEqual(15);
    expect(deck.data.slides.flatMap((s) => s.bullets).join(' ')).toMatch(/indirect|moist|month/i);
  } finally {
    await ctx.close();
  }
});
