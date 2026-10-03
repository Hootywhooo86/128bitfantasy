import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the pure logic — provider parsing, normalising, prompts.
 * No React Native, no device. Keep platform imports out of anything tested.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'android/**', 'ios/**'],
    environment: 'node',
  },
});
