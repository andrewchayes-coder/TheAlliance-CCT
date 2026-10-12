import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../alliance-volunteer-portal/src', import.meta.url)) } },
  test: { include: ['src/server/**/*.test.ts', 'src/schedule-settings.test.ts',
    '../alliance-volunteer-portal/src/lib/coordinator.test.ts',
    '../alliance-volunteer-portal/src/lib/reminder-job-health.test.ts'], fileParallelism: false,
    maxWorkers: 1, testTimeout: 15000, hookTimeout: 30000 },
});
