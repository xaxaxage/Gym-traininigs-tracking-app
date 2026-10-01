import { defineConfig } from 'vitest/config';

/** Tests of the built connectors (`npm run build && npm run build:cloud` first): `npm run test:built`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/built/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
