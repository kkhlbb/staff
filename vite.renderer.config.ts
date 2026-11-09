import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL('./index.desktop.html', import.meta.url)),
    },
  },
})
