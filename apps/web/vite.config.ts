import { execFileSync } from 'node:child_process'
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

// Bridge the Supabase integration's un-prefixed vars onto the VITE_* names Vite
// exposes (spec §4.2). On Vercel the integration injects `SUPABASE_URL` /
// `SUPABASE_ANON_KEY`; folding them here avoids a manual duplication in the
// dashboard. Locally both are empty ⇒ `supabase = null` ⇒ web auth is OFF.
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''

/**
 * Revision of the code being built — the source "Réglages → À propos" prints as
 * the version (see `src/lib/build-info.ts` for why it is not `package.json`).
 * Vercel injects `VERCEL_GIT_COMMIT_SHA` and does not always leave a usable
 * `.git` behind, so it wins; locally git answers. Neither available (a source
 * tarball) ⇒ empty, and About degrades to the build date rather than inventing
 * a number. Never throws: a version string must not be able to fail a build.
 */
function commitSha(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

// Host the landing's fake browser chrome is labelled with. Normally EMPTY: the
// page reads its own `window.location.host`, which is already the truth in prod
// and in dev alike. Set only by the capture script, whose runtime host (:5176)
// is not the host `og.png` advertises. See `src/lib/build-info.ts#siteHost`.
const siteHost = process.env.VITE_SITE_HOST ?? ''

export default defineConfig({
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnon),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(commitSha()),
    'import.meta.env.VITE_APP_BUILT_AT': JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_SITE_HOST': JSON.stringify(siteHost),
  },
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
          // KaTeX (~260 kB) + the whole math parsing/rendering stack are heavy and
          // math-ONLY. Group them ALL here so `vendor-katex` is self-contained:
          // its sole outgoing deps are the low-level hast/unist/micromark utils
          // (shared, in `vendor-markdown`), and NOTHING in `vendor-markdown`
          // imports a math package — so there is no `vendor-katex ↔ vendor-markdown`
          // cycle and, crucially, no static edge from the base Markdown path into
          // KaTeX. This rule runs FIRST so these packages never fall into the
          // greedy markdown rule below. `vendor-katex` is imported only by the lazy
          // `markdown-math` module, so it loads exclusively for math-bearing cards.
          if (
            /[\\/]node_modules[\\/](katex|rehype-katex|remark-math|mdast-util-math|micromark-extension-math)[\\/]/.test(
              id,
            )
          )
            return 'vendor-katex'
          // NOTE: recharts is deliberately NOT grouped here. `autoCodeSplitting`
          // already isolates it in the async /analytics route chunk. Forcing a
          // `vendor-charts` chunk backfired — a symbol recharts shares with common
          // code got hoisted into that chunk, so EVERY route imported it and the
          // ~100 kB chart bundle landed on the dashboard critical path (Phase 7
          // §2.3). Leaving recharts to route-splitting keeps it off /.
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
