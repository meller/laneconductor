#!/usr/bin/env node
// Makes the LaneConductor plugin icon: connector/plugin-extras/icon.png, 1024x1024, no dependencies (a tiny PNG
// encoder on node:zlib). Five vertical rounded lanes of different heights on the board's dark pine green.
// The generator (scripts/build-plugin.mjs) copies whatever PNG is at that path, so a hand-made icon can replace it.
//
//   node scripts/make-icon.mjs [out.png]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const BG = [0x0f, 0x16, 0x13]; // #0F1613, the board's background
const LANE = [0x5f, 0xc7, 0xa8]; // #5FC7A8, the board's lane colour
// Five lanes, left to right: height in pixels and how much of the lane colour (the rest is background), so the
// middle-right lane is the bright "active" one and the others are softer tints.
const LANES = [
  { h: 440, t: 0.42 },
  { h: 640, t: 0.68 },
  { h: 540, t: 0.42 },
  { h: 760, t: 1.0 },
  { h: 360, t: 0.68 },
];
const W = 116;
const GAP = 48;
const RADIUS = W / 2; // fully rounded ends
const x0 = (SIZE - (LANES.length * W + (LANES.length - 1) * GAP)) / 2;

const mix = (t) => BG.map((b, i) => b + (LANE[i] - b) * t);

// Signed distance (pixels, negative inside) from (px, py) to a rounded rectangle.
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const rows = [];
for (let y = 0; y < SIZE; y += 1) {
  const row = Buffer.alloc(1 + SIZE * 3); // filter byte 0 (none), then RGB
  for (let x = 0; x < SIZE; x += 1) {
    let rgb = BG;
    for (let i = 0; i < LANES.length; i += 1) {
      const cx = x0 + i * (W + GAP) + W / 2;
      const d = sdRoundRect(x + 0.5, y + 0.5, cx, SIZE / 2, W / 2, LANES[i].h / 2, RADIUS);
      if (d < 1) {
        const cover = Math.min(1, Math.max(0, 0.5 - d)); // 1 px anti-aliased edge
        const c = mix(LANES[i].t);
        rgb = rgb.map((b, k) => b + (c[k] - b) * cover);
        break;
      }
    }
    row[1 + x * 3] = Math.round(rgb[0]);
    row[2 + x * 3] = Math.round(rgb[1]);
    row[3 + x * 3] = Math.round(rgb[2]);
  }
  rows.push(row);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../connector/plugin-extras/icon.png'));
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${SIZE}x${SIZE})`);
