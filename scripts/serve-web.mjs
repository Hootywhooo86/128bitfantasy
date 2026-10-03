#!/usr/bin/env node
/**
 * Serves the `expo export -p web` output for local testing.
 *
 * A plain static server is not enough: expo-sqlite on web runs SQLite in a
 * worker via wa-sqlite, which needs SharedArrayBuffer, which browsers only
 * expose on a cross-origin-isolated page. That means COOP + COEP headers.
 *
 *   npm run build:web && npm run serve:web
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT ?? 8090);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(root)) {
  console.error(`No build at ${root}. Run "npm run build:web" first.`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(root, urlPath);

    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(root, 'index.html');
    }
    // Expo Router owns the routes; unknown paths fall back to the shell.
    if (!fs.existsSync(file)) file = path.join(root, 'index.html');

    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => {
    console.log(`128BIT FANTASY (web build) → http://localhost:${port}`);
    console.log('Cross-origin isolated, so expo-sqlite can use SharedArrayBuffer.');
  });
