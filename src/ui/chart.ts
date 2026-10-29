// Charts and KPI cards from a table (plan T9): hand-written SVG bars and lines, no library. Grays only, series told
// apart by gray steps and a legend; status colours only for a KPI's direction. Text goes in by textContent.
import { h } from './dom.ts';
import type { Cell, Table } from '../domain/outputs.ts';

/** The value range a chart draws: always holds 0, and a single value or a flat line still has height. */
export function scale(values: number[]): { lo: number; hi: number } {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;
  return { lo, hi };
}

const isNum = (c: Cell | undefined): c is number => typeof c === 'number';
/** Columns whose filled cells are all numbers (at least one). */
export const numericColumns = (t: Table): number[] =>
  t.columns.map((_, i) => i).filter((i) => t.rows.some((r) => isNum(r[i])) && t.rows.every((r) => r[i] == null || r[i] === '' || isNum(r[i])));

// The tokens are light-dark() values, which an SVG drawn to a canvas can't resolve: read each as a plain colour.
function colour(token: string): string {
  const probe = h('i', { style: `color: var(${token})`, hidden: true });
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const short = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(2)}`);

/** Bars or lines: the first text column labels the x axis (else the row number), up to 4 numeric columns are series. */
export function chart(t: Table, kind: 'bar' | 'line', width = 640, height = 320): SVGSVGElement {
  const series = numericColumns(t).slice(0, 4);
  const labelCol = t.columns.findIndex((_, i) => !series.includes(i));
  const rows = t.rows.slice(0, 60);
  const shades = ['--gray-12', '--gray-10', '--gray-8', '--gray-6'].map(colour);
  const [fg, muted, line, bg] = ['--fg', '--muted', '--line', '--bg'].map(colour) as [string, string, string, string];
  const svg = s('svg', { xmlns: SVG, viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'font-family': 'system-ui, sans-serif', 'font-size': 11 }) as SVGSVGElement;
  svg.append(s('rect', { width, height, fill: bg }));
  if (!series.length || !rows.length) {
    svg.append(s('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: muted }, 'No numbers to chart.'));
    return svg;
  }
  const values = rows.flatMap((r) => series.map((i) => r[i]).filter(isNum));
  const { lo, hi } = scale(values);
  const [left, right, top, bottom] = [48, 12, series.length > 1 ? 28 : 12, 40];
  const plotH = height - top - bottom;
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * plotH;
  const band = (width - left - right) / rows.length;
  for (const v of [lo, (lo + hi) / 2, hi, ...(lo < 0 ? [0] : [])]) {
    svg.append(s('line', { x1: left, x2: width - right, y1: y(v), y2: y(v), stroke: line, 'stroke-width': v === 0 ? 1.5 : 1 }));
    svg.append(s('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end', fill: muted }, short(v)));
  }
  rows.forEach((r, k) => {
    const label = labelCol >= 0 ? String(r[labelCol] ?? '') : String(k + 1);
    const every = Math.ceil(rows.length / 12);
    if (k % every === 0) svg.append(s('text', { x: left + band * (k + 0.5), y: height - bottom + 16, 'text-anchor': 'middle', fill: muted }, label.length > 14 ? `${label.slice(0, 13)}…` : label));
  });
  series.forEach((col, j) => {
    if (kind === 'bar') {
      const w = (band * 0.8) / series.length;
      rows.forEach((r, k) => {
        const v = r[col];
        if (!isNum(v)) return;
        svg.append(s('rect', { x: left + band * (k + 0.1) + w * j, y: Math.min(y(v), y(0)), width: Math.max(1, w - 1), height: Math.max(1, Math.abs(y(v) - y(0))), fill: shades[j]! }));
      });
    } else {
      const pts = rows.map((r, k) => (isNum(r[col]) ? `${left + band * (k + 0.5)},${y(r[col] as number)}` : '')).filter(Boolean);
      svg.append(s('polyline', { points: pts.join(' '), fill: 'none', stroke: shades[j]!, 'stroke-width': 2, ...(j > 0 && { 'stroke-dasharray': ['', '6 3', '2 3', '8 3 2 3'][j]! }) }));
    }
    if (series.length > 1) {
      svg.append(s('rect', { x: left + j * 140, y: 6, width: 10, height: 10, fill: shades[j]! }));
      svg.append(s('text', { x: left + j * 140 + 14, y: 15, fill: fg }, t.columns[col]!.replace(/_/g, ' ').slice(0, 18)));
    }
  });
  return svg;
}

/** One card per numeric column (up to 4): its last value and the change since the first row. */
export function kpis(t: Table): HTMLElement {
  return h('div', { className: 'kpis' }, ...numericColumns(t).slice(0, 4).map((i) => {
    const vals = t.rows.map((r) => r[i]).filter(isNum);
    const [first, last] = [vals[0]!, vals.at(-1)!];
    const change = vals.length > 1 && first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
    return h('div', { className: 'kpi' },
      h('span', { className: 'muted small', textContent: t.columns[i]!.replace(/_/g, ' ') }),
      h('b', { textContent: last.toLocaleString() }),
      change !== null && h('span', { className: `small ${change >= 0 ? 'good' : 'danger'}`, textContent: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% since the first row` }));
  }));
}

/** A chart as PNG, drawn at twice its size. */
export async function toPng(svg: SVGSVGElement): Promise<{ png: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const [w, hgt] = [svg.width.baseVal.value, svg.height.baseVal.value];
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await img.decode();
  const canvas = h('canvas', { width: w * 2, height: hgt * 2 });
  canvas.getContext('2d')!.drawImage(img, 0, 0, w * 2, hgt * 2);
  const blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('The chart could not be drawn.'))), 'image/png'));
  return { png: new Uint8Array(await blob.arrayBuffer()), width: w * 2, height: hgt * 2 };
}
