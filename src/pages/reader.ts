// Document reader: a PDF, ePub, DOCX, text, Markdown, CSV, JSON or HTML file as readable text, so the in-page UI (also
// loaded by reader.html) can select, summarize, translate and ask about it. Chrome's PDF viewer blocks extensions,
// which is why PDFs open here. Up to 10 files open together, with one question across them (plan T9).
import { $ } from './shell.ts';
import { h } from '../ui/dom.ts';
import { bg } from '../shared/protocol.ts';
import { markdown } from '../domain/markdown.ts';
import { citeLabel, filePassages, READER_FILES, type DocFile } from '../domain/reading.ts';
import { unzip } from '../domain/zip.ts';
import * as pdfjs from 'pdfjs-dist';

declare global { interface Window { mammoth: { convertToHtml(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> } } }

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/reading/pdf.worker.min.mjs');
const main = $('#doc');
const paras = (text: string) => text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => h('p', { textContent: t }));

async function pdfToNodes(data: ArrayBuffer): Promise<Node[]> {
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: HTMLElement[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const items = (await (await pdf.getPage(i)).getTextContent()).items as { str?: string; hasEOL?: boolean }[];
    // A line break where pdf.js marks the end of a line; a line ending a sentence closes a paragraph.
    const text = items.map((it) => (it.str ?? '') + (it.hasEOL ? (/[.!?:]\s*$/.test(it.str ?? '') ? '\n\n' : '\n') : '')).join('');
    pages.push(h('section', { className: 'page' }, h('h2', { textContent: `Page ${i}` }), ...paras(text)));
  }
  if (!pages.some((p) => p.querySelector('p'))) throw new Error('This PDF has no text layer (it is a scan). Use ❀ on its images to read them instead.');
  return pages;
}

/** ePub: container.xml → OPF → spine order → each chapter's headings and paragraphs. */
async function epubToNodes(buf: ArrayBuffer): Promise<Node[]> {
  const files = unzip(buf);
  const read = async (path: string) => {
    const f = files[path];
    if (!f) throw new Error(`Missing ${path}`);
    return new TextDecoder().decode(await f());
  };
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const opfPath = xml(await read('META-INF/container.xml')).querySelector('rootfile')?.getAttribute('full-path') ?? '';
  const opf = xml(await read(opfPath));
  const dir = opfPath.replace(/[^/]*$/, '');
  const href = Object.fromEntries([...opf.querySelectorAll('manifest > item')].map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
  const out: Node[] = [];
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent;
  if (title) out.push(h('p', { className: 'hint', textContent: title }));
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const path = decodeURIComponent(dir + (href[ref.getAttribute('idref') ?? ''] ?? '').split('#')[0]);
    if (!files[path]) continue;
    const body = new DOMParser().parseFromString(await read(path), 'text/html').body;
    const blocks = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre')]
      .map((b) => h(/^H\d$/.test(b.tagName) ? 'h2' : 'p', { textContent: (b.textContent ?? '').replace(/\s+/g, ' ').trim() }))
      .filter((b) => b.textContent);
    if (blocks.length) out.push(h('section', { className: 'page' }, ...blocks));
  }
  if (out.length < 2) throw new Error('No readable chapters in this ePub.');
  return out;
}

async function toNodes(name: string, type: string, buf: ArrayBuffer): Promise<Node[]> {
  const ext = (name.split(/[?#]/)[0]!.split('.').pop() ?? '').toLowerCase();
  // The file's own first bytes beat the URL: arXiv-style links (/pdf/2508.04412) have no .pdf extension.
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 64)));
  if (head.startsWith('%PDF') || ext === 'pdf' || type.includes('pdf')) return pdfToNodes(buf);
  if ((head.startsWith('PK') && head.includes('mimetypeapplication/epub')) || ext === 'epub' || type.includes('epub')) return epubToNodes(buf);
  if (ext === 'docx') {
    // mammoth emits plain markup, parsed inertly; the page's CSP blocks scripts anyway.
    const { value } = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    return [...new DOMParser().parseFromString(value, 'text/html').body.childNodes];
  }
  const text = new TextDecoder().decode(buf);
  if (ext === 'md') return [h('div', { innerHTML: markdown(text) })]; // escaped first
  if (ext === 'html' || ext === 'htm' || type.includes('html')) return paras(new DOMParser().parseFromString(text, 'text/html').body.innerText ?? '');
  if (ext === 'csv' || ext === 'json') return [h('pre', { textContent: text })];
  return paras(text);
}

async function show(name: string, type: string, getBuf: () => Promise<ArrayBuffer>): Promise<void> {
  document.title = `${name} · Homegrown reader`;
  main.replaceChildren(h('p', { className: 'hint', textContent: `Opening ${name}…` }));
  try {
    main.replaceChildren(h('h1', { textContent: name }), ...(await toNodes(name, type, await getBuf())));
  } catch (e) {
    main.replaceChildren(h('p', { className: 'err', textContent: `Couldn't open ${name}: ${(e as Error).message}` }));
  }
}

// A PDF's pages are its sections; any other file is one page.
const pagesOf = (nodes: Node[]): string[] => (nodes.length && nodes.every((n) => n instanceof HTMLElement && n.matches('section.page'))
  ? nodes.map((n) => [...(n as HTMLElement).querySelectorAll('p')].map((p) => p.textContent).join('\n\n'))
  : [nodes.map((n) => n.textContent ?? '').join('\n\n')]);

/** The question across files: code picks each file's best passages; a model measured for `cite` also answers. */
function askAcross(docs: DocFile[]): HTMLElement {
  const q = h('input', { id: 'ask-files-q', placeholder: `Ask across these ${docs.length} files`, ariaLabel: 'Question across the files' });
  const out = h('div', { id: 'ask-files-out' });
  const go = async () => {
    const question = q.value.trim();
    if (!question) return;
    const ps = filePassages(docs, question);
    const passages = h('ol', { className: 'passages' }, ...ps.map((p) => h('li', {}, h('b', { textContent: citeLabel(p) }), h('span', { textContent: ` ${p.text}` }))));
    const note = h('p', { className: 'hint', textContent: ps.length ? 'Writing a cited answer…' : 'No passage in these files matches the question.' });
    out.replaceChildren(note, passages);
    if (!ps.length) return;
    try {
      const cited = await bg<{ text: string; dropped: number; model: string } | null>('citeAnswer', { question, files: docs });
      if (!cited) return void (note.textContent = 'The best passages from each file. A cited answer needs a model measured for citing files.');
      note.replaceChildren(h('span', { className: 'answer', textContent: cited.text }),
        h('span', { textContent: ` (${cited.model}${cited.dropped ? `; ${cited.dropped} citation${cited.dropped > 1 ? 's' : ''} dropped: the page doesn’t hold the words` : ''})` }));
    } catch (e) {
      note.textContent = `No cited answer: ${(e as Error).message}`;
    }
  };
  return h('form', { className: 'ask-files', onsubmit: (e: Event) => (e.preventDefault(), void go()) }, q, h('button', { textContent: 'Ask' }), out);
}

async function showMany(files: File[]): Promise<void> {
  files = files.slice(0, READER_FILES);
  document.title = `${files.length} files · Homegrown reader`;
  main.replaceChildren(h('p', { className: 'hint', textContent: `Opening ${files.length} files…` }));
  const docs: DocFile[] = [];
  const parts: Node[] = [];
  for (const f of files) {
    try {
      const nodes = await toNodes(f.name, f.type, await f.arrayBuffer());
      docs.push({ name: f.name, pages: pagesOf(nodes) });
      parts.push(h('section', { className: 'file' }, h('h1', { textContent: f.name }), ...nodes));
    } catch (e) {
      parts.push(h('p', { className: 'err', textContent: `Couldn't open ${f.name}: ${(e as Error).message}` }));
    }
  }
  main.replaceChildren(...(docs.length > 1 ? [askAcross(docs)] : []), ...parts);
}

const openFiles = (fs: File[]) => (fs.length > 1 ? showMany(fs) : fs[0] ? show(fs[0].name, fs[0].type, () => fs[0]!.arrayBuffer()) : Promise.resolve());
$<HTMLInputElement>('#file').onchange = (e) => void openFiles([...(e.target as HTMLInputElement).files ?? []]);
addEventListener('dragover', (e) => (e.preventDefault(), main.classList.add('drop')));
addEventListener('dragleave', () => main.classList.remove('drop'));
addEventListener('drop', (e) => {
  e.preventDefault();
  main.classList.remove('drop');
  void openFiles([...e.dataTransfer?.files ?? []]);
});

const url = new URLSearchParams(location.search).get('url');
if (url) {
  void show(decodeURIComponent(url.split(/[?#]/)[0]!.split('/').pop() ?? '') || url, '', async () => {
    const res = await fetch(url).catch((e: unknown) => {
      // Local files need Chrome's per-extension "Allow access to file URLs" switch.
      if (url.startsWith('file:')) throw new Error('To open local files, turn on "Allow access to file URLs" for Homegrown in chrome://extensions (Details), or drop the file here.');
      throw e;
    }); // host permissions let the extension read any http(s) URL
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
}
