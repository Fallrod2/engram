import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// The web dev server proxies `/api/*` to the Hono server so the frontend can
// fetch same-origin during development. The target is configurable via
// `VITE_API_TARGET` (default `http://localhost:3001`) so the app can point at
// an alternate server instance (e.g. a throwaway port for verification).
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [
    // Router codegen must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
