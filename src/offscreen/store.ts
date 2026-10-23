// Model files in the origin-private file system (OPFS), with resumable downloads. For runtimes that load a file;
// a runtime that manages its own cache (WebLLM) wouldn't use this.
import type { ModelSpec } from '../domain/model.ts';

const COMMIT_EVERY = 64 << 20; // OPFS writes persist only on close(), so commit this often for resume
const root = () => navigator.storage.getDirectory();

export interface DownloadProgress { name: string; done: number; total: number; complete?: boolean; error?: string }

function fileOf(m: ModelSpec): { file: string; size: number; url: string } {
  const { file, sizeBytes, url } = m.source;
  if (!file || !sizeBytes || !url) throw new Error(`${m.id} is not a downloadable file.`);
  return { file, size: sizeBytes, url };
}

async function sizeOf(name: string): Promise<number> {
  try {
    return (await (await (await root()).getFileHandle(name)).getFile()).size;
  } catch {
    return 0;
  }
}

const active = new Map<string, { stop: AbortController; done: number }>();

export async function fileStatus(m: ModelSpec) {
  const { file, size } = fileOf(m);
  const d = active.get(m.id);
  return { downloaded: (await sizeOf(file)) === size, partial: d ? d.done : await sizeOf(`${file}.part`), downloading: !!d };
}

export const isDownloaded = async (m: ModelSpec) => (await fileStatus(m)).downloaded;

export async function openWeights(m: ModelSpec): Promise<File> {
  return (await (await root()).getFileHandle(fileOf(m).file)).getFile();
}

/** Downloads into `<file>.part`, resuming where an earlier attempt stopped. `url` overrides the source (tests). */
export async function download(m: ModelSpec, report: (p: DownloadProgress) => void, url?: string): Promise<void> {
  const { file, size, url: source } = fileOf(m);
  if (active.has(m.id) || (await sizeOf(file)) === size) return;
  const d = { stop: new AbortController(), done: 0 };
  active.set(m.id, d);
  const part = await (await root()).getFileHandle(`${file}.part`, { create: true });
  let w: FileSystemWritableFileStream | null = null;
  try {
    d.done = (await part.getFile()).size;
    if (d.done < size) {
      const headers: Record<string, string> = { 'Accept-Encoding': 'identity', ...(d.done && { Range: `bytes=${d.done}-` }) };
      const res = await fetch(url || source, { headers, signal: d.stop.signal });
      if (res.status === 200) d.done = 0; // the server ignored Range: start over
      else if (res.status !== 206) throw new Error(`Download failed: HTTP ${res.status}`);
      if (!res.body) throw new Error('Download failed: empty response');
      w = await part.createWritable({ keepExistingData: d.done > 0 });
      await w.seek(d.done);
      let sinceCommit = 0;
      let lastSent = 0;
      for await (const chunk of res.body) {
        await w.write(chunk);
        d.done += chunk.length;
        sinceCommit += chunk.length;
        if (sinceCommit >= COMMIT_EVERY) {
          await w.close();
          w = await part.createWritable({ keepExistingData: true });
          await w.seek(d.done);
          sinceCommit = 0;
        }
        if (performance.now() - lastSent > 250) {
          lastSent = performance.now();
          report({ name: m.id, done: d.done, total: size });
        }
      }
      await w.close();
      w = null;
    }
    if (d.done !== size) throw new Error(`Size mismatch: got ${d.done}, expected ${size}`);
    await part.move(file);
    report({ name: m.id, done: d.done, total: size, complete: true });
  } catch (e) {
    await w?.close().catch(() => {}); // keep what arrived, so the next attempt resumes
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    report({ name: m.id, done: d.done, total: size, error: aborted ? 'Paused' : e instanceof Error ? e.message : String(e) });
    if (!aborted) throw e;
  } finally {
    active.delete(m.id);
  }
}

export const pause = (m: ModelSpec) => active.get(m.id)?.stop.abort();

export async function removeFiles(m: ModelSpec): Promise<void> {
  const { file } = fileOf(m);
  const dir = await root();
  for (const f of [file, `${file}.part`]) await dir.removeEntry(f).catch(() => {});
}
