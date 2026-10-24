import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // A fixed zone with a non-zero offset, so tests prove times are shown in local time, not UTC.
    env: { TZ: 'Asia/Kolkata' },
  },
});
