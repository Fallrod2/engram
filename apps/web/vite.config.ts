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
  build: {
    rollupOptions: {
      output: {
        // Split the shared vendor into cacheable groups so the heavy, route-local
        // libraries stay OUT of the entry chunk (Phase 7 §2.3). Route code is
        // already async (TanStack `autoCodeSplitting`); this only regroups the
        // vendor a route pulls in. `recharts` (analytics only) and the markdown
        // stack (import + AI review only) must never land in the initial paint.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'vendor-charts'
          if (/[\\/]node_modules[\\/]d3-[^\\/]+[\\/]/.test(id)) return 'vendor-charts'
          if (
            /[\\/]node_modules[\\/](react-markdown|remark|remark-[^\\/]+|rehype-[^\\/]+|mdast[^\\/]*|micromark[^\\/]*|hast[^\\/]*|unist[^\\/]*|unified|vfile[^\\/]*|property-information|space-separated-tokens|comma-separated-tokens|hastscript|web-namespaces|zwitch|longest-streak|character-entities[^\\/]*|decode-named-character-reference|trim-lines|bail|is-plain-obj|trough|devlop|estree-util-is-identifier-name)[\\/]/.test(
              id,
            )
          )
            return 'vendor-markdown'
          if (/[\\/]node_modules[\\/]motion([\\/]|-dom|-utils|$)/.test(id)) return 'vendor-motion'
          if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) return 'vendor-motion'
          if (/[\\/]node_modules[\\/](@radix-ui|cmdk)[\\/]/.test(id)) return 'vendor-radix'
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-tanstack'
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return 'vendor-react'
          return undefined
        },
      },
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
