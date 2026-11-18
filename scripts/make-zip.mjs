#!/usr/bin/env node
// Builds the zip for Claude's "Upload plugin" from one generated plugin (the base `laneconductor` by default), deterministically: the same
// sources give the same bytes (sorted paths, fixed timestamp 1980-01-01, fixed permissions, no extra fields, no dependencies:
// only node's zlib). The plugin's files sit at the zip's top level (.claude-plugin/plugin.json is at the root of the archive).
//
//   node scripts/make-zip.mjs --out <dir-or-file.zip> [--plugin base|parallel|board]
//
// --out is required, so nothing is ever written into the repository by accident (a path inside the repo is refused).
// A directory gets `<plugin name>-<version>.zip`. Prints the path, the file count, the size and the SHA-256.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { REPO, NAMES, PROFILES, buildPlugin } from './build-plugin.mjs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

/** Zip of `files` (Map<path, { content: Buffer, exec: boolean }>), paths sorted, deflated, no zip64 (every file is small). */
export function makeZip(files) {
  const names = [...files.keys()].sort();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const { content, exec } = files.get(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    const stored = deflated.length >= content.length;
    const data = stored ? content : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(((exec ? 0o100755 : 0o100644) << 16) >>> 0, 38); // external attributes: Unix mode
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Reads a zip made by makeZip back into Map<path, { content, mode }> (enough for the tests and for self-checking). */
export function readZip(zip) {
  const eocd = zip.length - 22;
  if (zip.readUInt32LE(eocd) !== 0x06054b50) throw new Error('not a zip made by makeZip');
  const count = zip.readUInt16LE(eocd + 10);
  const out = new Map();
  for (let i = 0, o = zip.readUInt32LE(eocd + 16); i < count; i += 1) {
    const method = zip.readUInt16LE(o + 10);
    const crc = zip.readUInt32LE(o + 16);
    const csize = zip.readUInt32LE(o + 20);
    const nameLen = zip.readUInt16LE(o + 28);
    const mode = zip.readUInt32LE(o + 38) >>> 16;
    const local = zip.readUInt32LE(o + 42);
    const name = zip.toString('utf8', o + 46, o + 46 + nameLen);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + csize);
    const content = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (crc32(content) !== crc) throw new Error(`${name}: bad checksum`);
    out.set(name, { content, mode });
    o += 46 + nameLen;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outArg = i < 0 ? undefined : process.argv[i + 1];
  try {
    if (!outArg) throw new Error('usage: node scripts/make-zip.mjs --out <dir-or-file.zip> [--plugin base|parallel|board] (outside the repository)');
    const j = process.argv.indexOf('--plugin');
    const profile = j < 0 ? 'base' : process.argv[j + 1];
    if (!PROFILES.includes(profile)) throw new Error(`--plugin must be one of ${PROFILES.join(', ')}`);
    const files = buildPlugin(REPO, profile);
    const version = JSON.parse(files.get('.claude-plugin/plugin.json').content.toString('utf8')).version;
    let out = path.resolve(outArg);
    if (!out.endsWith('.zip')) out = path.join(out, `${NAMES[profile]}-${version}.zip`); // a directory (created if missing)
    const rel = path.relative(REPO, out);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`refusing to write inside the repository: ${out}`);
    const zip = makeZip(files);
    readZip(zip); // self-check: every entry inflates and matches its checksum
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zip);
    console.log(`${out}\nfiles:  ${files.size}\nbytes:  ${zip.length}\nsha256: ${crypto.createHash('sha256').update(zip).digest('hex')}`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
