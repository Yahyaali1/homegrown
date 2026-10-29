// Reading a zip (ePub, DOCX) from its central directory: stored and deflated entries, the two an ePub uses, with the
// platform's DecompressionStream. No library.

export type Zip = Record<string, () => Promise<Uint8Array>>;

export function unzip(buf: ArrayBuffer): Zip {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let end = buf.byteLength - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  const files: Zip = {};
  for (let i = 0, p = v.getUint32(end + 16, true); i < v.getUint16(end + 10, true); i++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const data = u8.slice(start, start + size);
    files[name] = async () =>
      method === 0 ? data : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return files;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** A zip of stored (uncompressed) entries: what PPTX needs, and readable by every unzip. */
export function zipWrite(entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  const header = (size: number, write: (v: DataView) => void) => {
    const b = new Uint8Array(size);
    write(new DataView(b.buffer));
    return b;
  };
  for (const { name, data } of entries) {
    const n = new TextEncoder().encode(name);
    const crc = crc32(data);
    // The fields local and central headers share: version 20, UTF-8 names (bit 11), stored, 1980-01-01.
    const common = (v: DataView, at: number) => {
      v.setUint16(at, 20, true);
      v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 8, 33, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, data.length, true);
      v.setUint32(at + 18, data.length, true);
      v.setUint16(at + 22, n.length, true);
    };
    parts.push(header(30, (v) => (v.setUint32(0, 0x04034b50, true), common(v, 4))), n, data);
    central.push(header(46, (v) => (v.setUint32(0, 0x02014b50, true), v.setUint16(4, 20, true), common(v, 6), v.setUint32(42, off, true))), n);
    off += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, off, true);
  });
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of all) out.set(b, (p += b.length) - b.length);
  return out;
}
