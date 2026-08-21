/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En producción el cliente usa VITE_API_URL. En desarrollo, sin esa variable,
// pega a rutas relativas y este proxy las lleva al core de la máquina.
const CORE_LOCAL = 'http://localhost:8080'

export default defineConfig(({ command }) => ({
  // El build de producción se sirve bajo /panel/ (la landing vive en la raíz
  // del mismo servidor, ver panel/nginx.conf). El dev server sigue en la raíz
  // para no cambiar el flujo de `npm run dev`.
  base: command === 'build' ? '/panel/' : '/',
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
}))
