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
