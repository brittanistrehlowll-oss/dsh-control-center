import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'tests/**/*.test.ts'
    ],
    environment: 'node',
    reporters: ['default'],
    testTimeout: 15_000,
    hookTimeout: 15_000
  }
});
