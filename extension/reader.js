// Document reader: shows a PDF, ePub, DOCX, text, Markdown, CSV, JSON or HTML file as plain readable text,
// so the content scripts (loaded by reader.html) can select, summarize, translate and ask about it.
// Chrome's own PDF viewer blocks extensions, which is why PDFs open here.
import * as pdfjs from './vendor/reading/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/reading/pdf.worker.min.mjs');
const main = document.getElementById('doc');
const el = (tag, props = {}, kids = []) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const paras = (text) => text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => el('p', { textContent: t }));

async function pdfToNodes(data) {
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const items = (await (await pdf.getPage(i)).getTextContent()).items;
    // Line breaks where pdf.js marks the end of a line; a short line ending a sentence closes a paragraph.
    const text = items.map((it) => it.str + (it.hasEOL ? (/[.!?:]\s*$/.test(it.str) ? '\n\n' : '\n') : '')).join('');
    pages.push(el('section', { className: 'page' }, [el('h2', { textContent: `Page ${i}` }), ...paras(text)]));
  }
  if (!pages.some((p) => p.querySelector('p'))) throw new Error('This PDF has no text layer (it is a scan). Use ✦ on its images to read them instead.');
  return pages;
}

// Zip entries by name, each a function returning its bytes. Reads the central directory; handles stored
// and deflated entries (all an ePub uses) with the built-in DecompressionStream.
function unzip(buf) {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let end = buf.byteLength - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  const files = {};
  for (let i = 0, p = v.getUint32(end + 16, true); i < v.getUint16(end + 10, true); i++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const data = u8.subarray(start, start + size);
    files[name] = async () =>
      method === 0 ? data : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return files;
}

// ePub: container.xml → OPF → spine order → each chapter's headings and paragraphs.
async function epubToNodes(buf) {
  const files = unzip(buf);
  const read = async (path) => new TextDecoder().decode(await files[path]());
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const opfPath = xml(await read('META-INF/container.xml')).querySelector('rootfile').getAttribute('full-path');
  const opf = xml(await read(opfPath));
  const dir = opfPath.replace(/[^/]*$/, '');
  const href = Object.fromEntries([...opf.querySelectorAll('manifest > item')].map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
  const out = [];
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent;
  if (title) out.push(el('p', { className: 'hint', textContent: title }));
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const path = decodeURIComponent(dir + (href[ref.getAttribute('idref')] || '').split('#')[0]);
    if (!files[path]) continue;
    const body = new DOMParser().parseFromString(await read(path), 'text/html').body;
    const blocks = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre')]
      .map((b) => el(/^H\d$/.test(b.tagName) ? 'h2' : 'p', { textContent: b.textContent.replace(/\s+/g, ' ').trim() }))
      .filter((b) => b.textContent);
    if (blocks.length) out.push(el('section', { className: 'page' }, blocks));
  }
  if (out.length < 2) throw new Error('No readable chapters in this ePub.');
  return out;
}

async function toNodes(name, type, buf) {
  const ext = (name.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  // The file's own first bytes beat the URL: arXiv-style links (/pdf/2508.04412) have no .pdf extension.
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 64)));
  if (head.startsWith('%PDF') || ext === 'pdf' || type.includes('pdf')) return pdfToNodes(buf);
  if (head.startsWith('PK') && head.includes('mimetypeapplication/epub')) return epubToNodes(buf);
  if (ext === 'epub' || type.includes('epub')) return epubToNodes(buf);
  if (ext === 'docx') {
    const { value } = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    return [...new DOMParser().parseFromString(value, 'text/html').body.childNodes]; // mammoth emits plain markup; extension CSP blocks scripts anyway
  }
  const text = new TextDecoder().decode(buf);
  if (ext === 'md') return [el('div', { innerHTML: window.EG.markdown(text) })];
  if (ext === 'html' || ext === 'htm' || type.includes('html')) return paras(new DOMParser().parseFromString(text, 'text/html').body.innerText);
  if (['csv', 'json'].includes(ext)) return [el('pre', { textContent: text })];
  return paras(text);
}

async function show(name, type, getBuf) {
  document.title = `${name} · Homegrown reader`;
  main.replaceChildren(el('p', { className: 'hint', textContent: `Opening ${name}…` }));
  try {
    const nodes = await toNodes(name, type, await getBuf());
    main.replaceChildren(el('h1', { textContent: name }), ...nodes);
  } catch (e) {
    main.replaceChildren(el('p', { className: 'err', textContent: `Couldn't open ${name}: ${e.message}` }));
  }
}

const openFile = (f) => show(f.name, f.type, () => f.arrayBuffer());
document.getElementById('file').onchange = (e) => e.target.files[0] && openFile(e.target.files[0]);
addEventListener('dragover', (e) => (e.preventDefault(), main.classList.add('drop')));
addEventListener('dragleave', () => main.classList.remove('drop'));
addEventListener('drop', (e) => {
  e.preventDefault();
  main.classList.remove('drop');
  if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
});

const url = new URLSearchParams(location.search).get('url');
if (url) {
  show(decodeURIComponent(url.split(/[?#]/)[0].split('/').pop()) || url, '', async () => {
    const res = await fetch(url).catch((e) => {
      // Local files need Chrome's per-extension "Allow access to file URLs" switch.
      if (url.startsWith('file:')) throw new Error('To open local files, turn on "Allow access to file URLs" for Homegrown in chrome://extensions (Details), or drop the file here.');
      throw e;
    }); // host_permissions let the extension read any http(s) URL
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
}
