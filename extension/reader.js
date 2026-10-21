// Document reader: shows a PDF, DOCX, text, Markdown, CSV, JSON or HTML file as plain readable text,
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

async function toNodes(name, type, buf) {
  const ext = (name.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || type.includes('pdf')) return pdfToNodes(buf);
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
  document.title = `${name} · Edge Gallery reader`;
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
    const res = await fetch(url); // host_permissions let the extension read any http(s) URL
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
}
