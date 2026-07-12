import { app } from '../apps/server/src/app'

/**
 * Vercel serverless entry point (Node.js runtime).
 *
 * The pure Hono application lives in `apps/server/src/app.ts` and is reused here
 * verbatim — this file only adapts it to Vercel's invocation contract. The local
 * dev entrypoint (`apps/server/src/index.ts`, run by `bun run dev`) is untouched.
 *
 * Vercel's Node.js runtime detects a Web handler when the default export exposes a
 * `fetch(request)` method (or named `GET`/`POST`/… exports) — a bare default-exported
 * function is instead treated as a legacy `(req, res)` Node handler. We therefore
 * export an object with a `fetch` method, which is exactly the shape of Hono's
 * `app.fetch` and the pattern both Vercel and Hono document for the Node.js runtime.
 * `vercel.json` rewrites `/api/(.*)` to this function; the rewrite preserves the
 * original request URL (e.g. `/api/health`), so Hono's router — which mounts every
 * route under `/api/*` — matches it directly with no path rewriting.
 */
export default {
  fetch: app.fetch,
}
