/**
 * Draws the 128BIT FANTASY logo — a pixel whistle — and writes every icon size.
 *
 *   node scripts/build-logo.mjs
 *
 * No image libraries: the whistle is a 24×24 grid built from a few shapes, and
 * PNGs are encoded by hand with zlib. Same palette as 128BIT FIT's heart so the
 * family reads as one set.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PALETTE = {
  O: [15, 31, 69, 255], // navy outline (FIT's heart detail colour)
  T: [38, 211, 195, 255], // teal body (FIT's heart)
  D: [24, 160, 150, 255], // teal shadow
  H: [214, 248, 242, 255], // highlight
  K: [15, 31, 69, 255], // air slot
};

const N = 24;

function draw() {
  const g = Array.from({ length: N }, () => Array(N).fill('.'));
  const cx = 15.5, cy = 14.5, r = 7.6;
  const inCircle = (x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
  const inMouth = (x, y) => x >= 1 && x <= 13 && y >= 8 && y <= 12;
  const body = (x, y) => inCircle(x, y) || inMouth(x, y);

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!body(x, y)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx < 0 || ny < 0 || nx >= N || ny >= N || !body(nx, ny);
      });
      if (edge) g[y][x] = 'O';
      else {
        // Light from the top-left: shadow on the lower-right of the chamber.
        const shade = inCircle(x, y) && (x + 0.5 - cx) + (y + 0.5 - cy) > 6;
        g[y][x] = shade ? 'D' : 'T';
      }
    }

  // The air slot on top of the mouthpiece, where it meets the chamber.
  for (const [x, y] of [[9, 9], [10, 9], [11, 9], [9, 10], [10, 10]]) g[y][x] = 'K';
  // Highlights: a glint on the mouthpiece and on the chamber.
  for (const [x, y] of [[3, 9], [4, 9], [5, 9], [3, 10]]) g[y][x] = 'H';
  for (const [x, y] of [[12, 12], [13, 12], [12, 13]]) g[y][x] = 'H';

  // Lanyard ring above the chamber.
  const ring = [[18, 2], [19, 2], [20, 2], [17, 3], [21, 3], [17, 4], [21, 4], [17, 5], [21, 5], [18, 6], [19, 6], [20, 6]];
  for (const [x, y] of ring) g[y][x] = 'O';
  // Ties the ring to the chamber.
  g[7][18] = 'O';
  return g;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** size: output px. pad: fraction of size left empty on each side. bg: RGBA or null. */
function png(grid, size, pad = 0, bg = null) {
  const inner = Math.floor(size * (1 - 2 * pad));
  const scale = Math.max(1, Math.floor(inner / N));
  const off = Math.floor((size - scale * N) / 2);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - off) / scale), gy = Math.floor((y - off) / scale);
      const cell = gx >= 0 && gy >= 0 && gx < N && gy < N ? grid[gy][gx] : '.';
      const px = cell === '.' ? bg ?? [0, 0, 0, 0] : PALETTE[cell];
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg(grid) {
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  const rects = [];
  grid.forEach((row, y) => row.forEach((cell, x) => {
    if (cell !== '.') rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex(PALETTE[cell])}"/>`);
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

function out(rel, data) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log('wrote', rel);
}

const g = draw();
// Grid cells stay whole pixels at every size, so the art never blurs.
const BLACK = [0, 0, 0, 255];
out('assets/brand/logo.svg', svg(g));
out('assets/brand/logo.png', png(g, 552, 0.0));
out('assets/brand/logo-topbar.png', png(g, 72, 0.0));
out('assets/images/icon.png', png(g, 1024, 0.14, BLACK));
out('assets/images/splash-icon.png', png(g, 1024, 0.2));
out('assets/images/favicon.png', png(g, 48, 0.0));
out('assets/images/android-icon-foreground.png', png(g, 1024, 0.25));
out('assets/images/android-icon-background.png', png(g.map((r) => r.map(() => '.')), 1024, 0, BLACK));
console.log(g.map((r) => r.join('')).join('\n'));
