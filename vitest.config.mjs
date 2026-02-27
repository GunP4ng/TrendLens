import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/index.js'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
});
