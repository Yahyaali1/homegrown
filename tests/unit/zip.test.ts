// The reader opens ePub and DOCX files, which are zips with stored and deflated entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { unzip } from '../../src/domain/zip.ts';

/** A minimal zip: one stored and one deflated entry, with local headers and a central directory. */
function makeZip(entries: { name: string; data: Buffer; deflate: boolean }[]): ArrayBuffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(e.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, cd, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

test('stored and deflated entries both read back', async () => {
  const chapter = '<p>Chapter one. '.repeat(50);
  const files = unzip(makeZip([{ name: 'mimetype', data: Buffer.from('application/epub+zip'), deflate: false }, { name: 'OEBPS/ch1.xhtml', data: Buffer.from(chapter), deflate: true }]));
  assert.deepEqual(Object.keys(files), ['mimetype', 'OEBPS/ch1.xhtml']);
  assert.equal(new TextDecoder().decode(await files.mimetype!()), 'application/epub+zip');
  assert.equal(new TextDecoder().decode(await files['OEBPS/ch1.xhtml']!()), chapter);
});

test('a file that isn\'t a zip says so', () => {
  assert.throws(() => unzip(new TextEncoder().encode('just text, not a zip at all').buffer as ArrayBuffer), /Not a zip/);
});
