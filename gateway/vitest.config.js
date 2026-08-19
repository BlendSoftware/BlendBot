import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Nada de red ni de API key real: si un test tarda, es un cuelgue, no lentitud.
    testTimeout: 10_000,
  },
});
