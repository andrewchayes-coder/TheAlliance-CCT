import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/server/**/*.test.ts', 'src/schedule-settings.test.ts'], fileParallelism: false,
    maxWorkers: 1, testTimeout: 15000, hookTimeout: 30000 },
});
