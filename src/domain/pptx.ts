// A deck as PowerPoint: the least Office Open XML a .pptx needs (one master, one layout, one theme),
// one slide part per slide with its title, bullets and, for a chart, a PNG picture. Packed by zipWrite. No library.
import type { Deck } from './outputs.ts';
import { zipWrite } from './zip.ts';

export const xml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');

/** "rgb(12, 34, 56)" or "#abc" → "0C2238"; anything else → the fallback. */
export function hex(css: string | undefined, fallback: string): string {
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css ?? '');
  if (rgb) return rgb.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css ?? '')?.[1];
  return h ? (h.length === 3 ? [...h].map((c) => c + c).join('') : h).toUpperCase() : fallback;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string][]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
const W = 12192000, H = 6858000; // 16:9 in EMU

const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Homegrown"><a:themeElements>` +
  `<a:clrScheme name="Homegrown"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>` +
  ['444444', '666666', '888888', 'AAAAAA', 'CCCCCC', 'DDDDDD'].map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('') +
  '<a:hlink><a:srgbClr val="0B57D0"/></a:hlink><a:folHlink><a:srgbClr val="6B4FBB"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Homegrown"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Homegrown"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:fillStyleLst>' +
  '<a:lnStyleLst>' + '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3) + '</a:lnStyleLst>' +
  '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst>' +
  '<a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

export interface PptxStyle { bg?: string; text?: string; font?: string }

const run = (text: string, size: number, s: Required<PptxStyle>, bold = false) =>
  `<a:r><a:rPr lang="en-US" sz="${size}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${s.text}"/></a:solidFill><a:latin typeface="${xml(s.font)}"/></a:rPr><a:t>${xml(text)}</a:t></a:r>`;
const box = (id: number, name: string, x: number, y: number, w: number, h: number, body: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
  `<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;

/**
 * The deck as .pptx bytes. `pictures[i]` is slide i's chart as PNG with its pixel size (the page draws it); a slide
 * without one has none. Colours are CSS colours from a brand kit; the defaults are black on white.
 */
export function pptx(deck: Deck, pictures: ({ png: Uint8Array; width: number; height: number } | undefined)[] = [], style: PptxStyle = {}): Uint8Array<ArrayBuffer> {
  const s: Required<PptxStyle> = { bg: hex(style.bg, 'FFFFFF'), text: hex(style.text, '111111'), font: style.font?.split(',')[0]?.replace(/["']/g, '').trim() || 'Arial' };
  if (!deck.slides.length) throw new Error('A deck needs a slide.');
  const enc = (t: string) => new TextEncoder().encode(t);
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, text: string) => files.push({ name, data: enc(text) });

  add('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    deck.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
  add('_rels/.rels', rels([['officeDocument', 'ppt/presentation.xml']]));
  add('ppt/presentation.xml', `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/></p:presentation>`);
  add('ppt/_rels/presentation.xml.rels', rels([['slideMaster', 'slideMasters/slideMaster1.xml'], ['theme', 'theme/theme1.xml'], ...deck.slides.map((_, i): [string, string] => ['slide', `slides/slide${i + 1}.xml`])]));
  add('ppt/slideMasters/slideMaster1.xml', `${HEAD}<p:sldMaster ${NS}><p:cSld>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['theme', '../theme/theme1.xml']]));
  add('ppt/slideLayouts/slideLayout1.xml', `${HEAD}<p:sldLayout ${NS} type="blank"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld></p:sldLayout>`);
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['slideMaster', '../slideMasters/slideMaster1.xml']]));
  add('ppt/theme/theme1.xml', THEME);

  const M = 457200; // half an inch
  deck.slides.forEach((slide, i) => {
    const pic = pictures[i];
    const first = i === 0;
    const title = box(2, 'Title', M, first ? H / 3 : M, W - 2 * M, first ? 1371600 : 914400,
      `<a:p>${run(slide.title, first ? 4000 : 2800, s, true)}</a:p>`);
    const bulletsTop = first ? H / 3 + 1371600 : M + 1005840;
    const bullets = slide.bullets.length ? box(3, 'Text', M, bulletsTop, pic ? (W - 2 * M) / 2 : W - 2 * M, H - bulletsTop - M,
      slide.bullets.map((b) => `<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr>${run(b, 1800, s)}</a:p>`).join('')) : '';
    let picture = '';
    if (pic) {
      const left = slide.bullets.length ? W / 2 : M;
      const [bw, bh] = [W - left - M, H - bulletsTop - M];
      const k = Math.min(bw / pic.width, bh / pic.height);
      picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Chart"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr><a:xfrm><a:off x="${Math.round(left)}" y="${Math.round(bulletsTop)}"/><a:ext cx="${Math.round(pic.width * k)}" cy="${Math.round(pic.height * k)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      files.push({ name: `ppt/media/image${i + 1}.png`, data: pic.png });
    }
    add(`ppt/slides/slide${i + 1}.xml`, `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${s.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
      EMPTY_TREE.replace('</p:spTree>', `${title}${bullets}${picture}</p:spTree>`) + '</p:cSld></p:sld>');
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ...(pic ? [['image', `../media/image${i + 1}.png`] as [string, string]] : [])]));
  });
  return zipWrite(files);
}
