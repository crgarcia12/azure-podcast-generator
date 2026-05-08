import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    env: {
      JWT_SECRET: 'test-jwt-secret-for-vitest',
      LOG_LEVEL: 'silent',
      REGISTRATION_ENABLED: 'true',
      // Make the SSE cast stream finish instantly in unit tests.
      CAST_SEGMENT_PACE_MS: '0',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
