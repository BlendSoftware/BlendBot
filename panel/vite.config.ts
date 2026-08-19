/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En producción el cliente usa VITE_API_URL. En desarrollo, sin esa variable,
// pega a rutas relativas y este proxy las lleva al core de la máquina.
const CORE_LOCAL = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: CORE_LOCAL, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
