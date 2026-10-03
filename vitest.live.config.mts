import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Live contract tests against the real APIs. Network required. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  test: { include: ['contract/**/*.live.ts'], environment: 'node' },
});
