/**
 * Draws the 128BIT FANTASY logo — a silver pixel whistle on an angle — and writes every icon size.
 *
 *   node scripts/build-logo.mjs
 *
 * No image libraries: the whistle is a 28×28 grid built from a few shapes, and
 * PNGs are encoded by hand with zlib. Silver, tilted mid-blow.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PALETTE = {
  O: [70, 76, 86, 255], // gunmetal outline — light enough to read on black
  T: [196, 202, 211, 255], // silver body
  D: [134, 141, 152, 255], // silver shadow
  H: [255, 255, 255, 255], // shine
  K: [38, 42, 50, 255], // air slot
  R: [98, 105, 116, 255], // lanyard ring
};

const N = 28;
/** Tilt, in degrees. Negative lifts the mouthpiece, like it's mid-blow. */
const ANGLE = -24;

/**
 * The whistle is described flat, in its own coordinates (origin at the
 * chamber's centre, mouthpiece pointing left), then every grid pixel is
 * rotated back into that frame and tested. Rotating the shape rather than the
 * finished pixels keeps the edges clean at an angle.
 */
function draw() {
  const g = Array.from({ length: N }, () => Array(N).fill('.'));
  const a = (ANGLE * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const ox = 17.6, oy = 16.6; // where the chamber centre lands on the grid

  /** Grid pixel → flat whistle coordinates. */
  const local = (x, y) => {
    const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  };
  const R = 7.4;
  const inChamber = (u, v) => u * u + v * v <= R * R;
  const inMouth = (u, v) => u >= -12.6 && u <= 0 && v >= -R && v <= -R + 6.6;
  const body = (u, v) => inChamber(u, v) || inMouth(u, v);
  const ring = (u, v) => {
    const d = Math.hypot(u - 4.2, v + R + 2.1);
    return d >= 1.5 && d <= 2.9;
  };

  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? false : body(...local(x, y)));

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const [u, v] = local(x, y);
      if (body(u, v)) {
        // Eight neighbours, not four: at an angle a four-neighbour outline leaves
        // diagonal gaps and the silver bleeds into the background.
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => !at(x + dx, y + dy));
        if (edge) g[y][x] = 'O';
        // The air slot, cut into the top where the mouthpiece meets the chamber.
        else if (u >= -4.2 && u <= -0.6 && v <= -R + 2.6) g[y][x] = 'K';
        // A shine stripe along the mouthpiece, and a glint on the chamber.
        else if (inMouth(u, v) && !inChamber(u, v) && v <= -R + 2.4 && u <= -5) g[y][x] = 'H';
        else if (Math.hypot(u + 3.2, v + 2.6) <= 0.95) g[y][x] = 'H';
        // Light from the top left: shadow on the lower right of the chamber.
        else if (inChamber(u, v) && u + v > 4.2) g[y][x] = 'D';
        else g[y][x] = 'T';
      } else if (ring(u, v)) {
        g[y][x] = 'R';
      }
    }
  // Drop outline pixels that outline nothing — single stray corners the
  // rotation leaves behind.
  const filled = (x, y) => y >= 0 && x >= 0 && y < N && x < N && 'THDK'.includes(g[y][x]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (g[y][x] === 'O' && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled(x + dx, y + dy))) g[y][x] = '.';
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
