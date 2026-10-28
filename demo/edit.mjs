// Cuts the recorded chapters (demo/record.mjs) into the README demo: an Apple-style title card before each chapter,
// the slow parts (the model thinking) sped up, the side panel set beside a page, short crossfades between shots.
// Writes docs/demo/homegrown-demo.mp4 and docs/demo/homegrown-demo.gif. Needs ffmpeg and gifski.
//   node demo/edit.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'demo/out');
const RAW = path.join(OUT, 'raw');
const CUT = path.join(OUT, 'cut');
const DOCS = path.join(ROOT, 'docs/demo');
const W = 1280, H = 800, FPS = 30, FADE = 0.35;
// Pace: interactions a little brisker than life; the model's waiting compressed further than the recorded marks.
const PACE = 1.3, WAIT_BOOST = 1.6;
fs.rmSync(CUT, { recursive: true, force: true });
fs.mkdirSync(CUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

const ff = (...args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const duration = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

const mark = encodeURIComponent(fs.readFileSync(path.join(ROOT, 'static/ui/flower.svg'), 'utf8').replaceAll('#202020', '#f5f5f7').replace('stroke="#ffffff"', 'stroke="#000"'));
// The story: a title card, then the chapter it introduces. *word* is drawn in the accent gradient.
const STORY = [
  ['title', { h: 'Homegrown', s: 'Your own AI. Grown on your machine.', mark }],
  ['title', { h: 'Select. *Ask.*', s: 'Answers stream in right where you read.' }], ['ask'],
  ['title', { h: 'Hard words, *made simple.*', s: 'Hold ⌥ and point at any word.' }], ['jargon'],
  ['title', { h: 'Writes *like you.*', s: 'Proofread. Draft a reply. Finish the sentence.' }], ['write'],
  ['title', { h: 'Every page, *your language.*', s: 'Translated side by side, as you scroll.' }], ['translate'],
  ['title', { h: 'Look *before* you click.', s: 'Every link checked before it opens.' }], ['links'],
  ['title', { h: 'It sees *pictures, too.*', s: 'Point at any image and ask.' }], ['images'],
  ['title', { h: 'Learn *anything.*', s: 'Mind maps and quizzes from any page.' }], ['learn'],
  ['title', { h: 'Everything, *one key away.*', s: '⌥K on any page.' }], ['palette'],
  ['title', { h: '*Missions.*', s: 'Give it a goal. It reads the pages and ranks what it finds.' }], ['mission'],
  ['title', { h: 'Never *overpay.*', s: 'It remembers prices across stores.' }], ['prices'],
  ['title', { h: 'Just *say it.*', s: 'Speech to text, on your machine.' }], ['voice'],
  ['title', { h: 'Captions for *anything.*', s: 'Any audio, live, in your language.' }], ['captions'],
  ['title', { h: 'Videos, *summarized.*', s: 'With timestamps that jump right there.' }], ['youtube'],
  ['title', { h: '*Imagine.*', s: 'Images made entirely on your machine.' }], ['imagine'],
  ['title', { h: 'It *remembers.*', s: 'Every answer and highlight, searchable.' }], ['library'],
  ['title', { h: 'Change anything. *Just ask.*', s: 'Settings, by conversation.' }], ['panel'],
  ['title', { h: 'Private. Offline. *Yours.*', s: 'No cloud. No account. No API key.' }],
  ['title', { h: 'Homegrown', s: 'Free and open source.', small: 'github.com/Yahyaali1/homegrown', mark }],
];

// ---- title cards: the HTML card recorded (3.2 s for the first and last, 2.05 s for the rest) ----
async function titles() {
  const b = await chromium.launch();
  const out = [];
  for (const [i, [kind, t]] of STORY.entries()) {
    if (kind !== 'title') continue;
    const dir = path.join(OUT, 'titles', String(i));
    fs.rmSync(dir, { recursive: true, force: true });
    const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
    const p = await ctx.newPage();
    const q = new URLSearchParams(Object.entries(t).map(([k, v]) => [k, k === 'mark' ? v : v]));
    await p.goto(`file://${path.join(ROOT, 'demo/title.html')}?${q}`);
    await p.waitForTimeout(i === 0 || i === STORY.length - 1 ? 3200 : 2050);
    await ctx.close();
    out[i] = fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
  }
  await b.close();
  return out;
}

// ---- a chapter: trimmed to its marks, with the waiting parts sped up ----
function cutChapter(name, file) {
  const { marks, viewport } = JSON.parse(fs.readFileSync(path.join(RAW, `${name}.json`), 'utf8'));
  const start = marks.find((m) => m.kind === 'start')?.at ?? 0;
  const end = marks.find((m) => m.kind === 'end')?.at ?? duration(file);
  // Segments between speed changes.
  const points = [{ at: start, speed: 1 }, ...marks.filter((m) => m.kind === 'speed' && m.at > start && m.at < end)];
  const segs = points.map((p, i) => ({ from: p.at, to: points[i + 1]?.at ?? end, speed: p.speed === 1 ? PACE : p.speed * WAIT_BOOST })).filter((s) => s.to - s.from > 0.05);
  const parts = segs.map((s, i) => `[0:v]trim=${s.from.toFixed(3)}:${s.to.toFixed(3)},setpts=(PTS-STARTPTS)/${s.speed},fps=${FPS}[s${i}]`);
  let graph = `${parts.join(';')};${segs.map((_, i) => `[s${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[v]`;
  const inputs = ['-i', file];
  if (viewport.width < W) {
    // The side panel beside the page it was opened on, as Chrome shows it.
    inputs.push('-loop', '1', '-i', path.join(OUT, 'panel-backdrop.png'));
    graph += `;[v]crop=${viewport.width}:${H}:0:0[p];[1:v]scale=${W}:${H},boxblur=1:1,eq=brightness=-0.03[bg];[bg][p]overlay=${W - viewport.width}:0:shortest=1,drawbox=x=${W - viewport.width - 1}:y=0:w=1:h=${H}:color=0xd2d2d7@1:t=fill[v2]`;
    graph = graph.replace(/\[v2\]$/, '[out]');
  } else graph = graph.replace(/\[v\]$/, '[out]');
  const out = path.join(CUT, `${name}.mp4`);
  ff(...inputs, '-filter_complex', graph, '-map', '[out]', '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', out);
  return out;
}

const titleFiles = await titles();
const clips = STORY.map(([kind], i) => {
  if (kind === 'title') {
    const out = path.join(CUT, `t${String(i).padStart(2, '0')}.mp4`);
    ff('-ss', '0.15', '-i', titleFiles[i], '-vf', `fps=${FPS},scale=${W}:${H}`, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', out);
    return out;
  }
  const raw = path.join(RAW, `${kind}.webm`);
  if (!fs.existsSync(raw)) throw new Error(`Missing chapter ${kind}: run demo/record.mjs first`);
  return cutChapter(kind, raw);
});

// ---- join with crossfades ----
const durs = clips.map(duration);
let graph = '';
let last = '[0:v]';
let offset = 0;
for (let i = 1; i < clips.length; i++) {
  offset += durs[i - 1] - FADE;
  const out = i === clips.length - 1 ? '[v]' : `[x${i}]`;
  graph += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${out};`;
  last = out;
}
const mp4 = path.join(DOCS, 'homegrown-demo.mp4');
ff(...clips.flatMap((c) => ['-i', c]), '-filter_complex', graph.replace(/;$/, ''), '-map', '[v]', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
console.log(`mp4: ${duration(mp4).toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);

// ---- GIF for the README: smaller and fewer frames, gifski for good colours ----
const frames = path.join(OUT, 'frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames);
const GIF_W = Number(process.env.GIF_W ?? 800), GIF_FPS = Number(process.env.GIF_FPS ?? 10);
ff('-i', mp4, '-vf', `fps=${GIF_FPS},scale=${GIF_W}:-1:flags=lanczos`, path.join(frames, 'f%05d.png'));
const gif = path.join(DOCS, 'homegrown-demo.gif');
execFileSync('gifski', ['--quiet', '--fps', String(GIF_FPS), '--quality', process.env.GIF_Q ?? '80', '--width', String(GIF_W), '-o', gif, ...fs.readdirSync(frames).sort().map((f) => path.join(frames, f))]);
console.log(`gif: ${(fs.statSync(gif).size / 1e6).toFixed(1)} MB`);
