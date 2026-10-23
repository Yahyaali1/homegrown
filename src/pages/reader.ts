// Document reader: a PDF, ePub, DOCX, text, Markdown, CSV, JSON or HTML file as readable text, so the in-page UI (also
// loaded by reader.html) can select, summarize, translate and ask about it. Chrome's PDF viewer blocks extensions,
// which is why PDFs open here.
import { $ } from './shell.ts';
import { h } from '../ui/dom.ts';
import { markdown } from '../domain/markdown.ts';
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

const openFile = (f: File) => show(f.name, f.type, () => f.arrayBuffer());
$<HTMLInputElement>('#file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void openFile(f);
};
addEventListener('dragover', (e) => (e.preventDefault(), main.classList.add('drop')));
addEventListener('dragleave', () => main.classList.remove('drop'));
addEventListener('drop', (e) => {
  e.preventDefault();
  main.classList.remove('drop');
  const f = e.dataTransfer?.files[0];
  if (f) void openFile(f);
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
