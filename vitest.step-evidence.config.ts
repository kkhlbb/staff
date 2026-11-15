import { defineConfig } from 'vitest/config'
export default defineConfig({test:{environment:'node',include:['scripts/step-evidence/*.evidence.test.ts'],testTimeout:30000}})
