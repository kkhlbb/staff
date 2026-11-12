import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/dxf-depth-samples.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
})
