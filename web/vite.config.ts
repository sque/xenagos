import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The built viewer goes into the Python package, which serves it (design decision 1).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/src/xenagos/static',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
  },
})
