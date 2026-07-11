import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web dev server proxies `/api/*` to the Hono server so the frontend
// can fetch same-origin during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
