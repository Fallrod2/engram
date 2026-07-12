import { app } from '../apps/server/src/app'

/**
 * Vercel serverless entry point (Node.js runtime).
 *
 * The pure Hono application lives in `apps/server/src/app.ts` and is reused here
 * verbatim — this file only adapts it to Vercel's invocation contract. The local
 * dev entrypoint (`apps/server/src/index.ts`, run by `bun run dev`) is untouched.
 *
 * Vercel's Node.js runtime calls a default-exported Web handler with a standard
 * `Request` and expects a `Response`, which is exactly the shape of Hono's
 * `app.fetch`. `vercel.json` rewrites `/api/(.*)` to this function; the rewrite
 * preserves the original request URL (e.g. `/api/health`), so Hono's router — which
 * mounts every route under `/api/*` — matches it directly with no path rewriting.
 */
export default function handler(request: Request): Response | Promise<Response> {
  return app.fetch(request)
}
