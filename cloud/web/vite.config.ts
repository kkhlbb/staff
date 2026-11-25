import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const cloudWebRoot = fileURLToPath(new URL('.', import.meta.url))
const cloudWebOutDir = fileURLToPath(new URL('./dist', import.meta.url))

export default defineConfig({
  root: cloudWebRoot,
  base: '/',
  plugins: [react()],
  build: {
    outDir: cloudWebOutDir,
    emptyOutDir: true,
    sourcemap: false,
  },
})
