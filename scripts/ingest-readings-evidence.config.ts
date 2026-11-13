import { defineConfig } from 'vitest/config'

// Explicit evidence command only; not part of normal tests or packaged code.
export default defineConfig({
  test: {
    include: ['scripts/ingest-readings-evidence.ts'],
    environment: 'node',
    setupFiles: [],
    testTimeout: 120_000,
  },
})
