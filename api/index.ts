/**
 * Vercel serverless entry point (Node.js runtime).
 *
 * The Hono app is NOT imported statically: Vercel's Node runtime evaluates TS
 * files one by one and cannot resolve the repo's extensionless imports, so the
 * buildCommand pre-bundles the whole server into `./app.bundle.mjs` (see
 * `app-entry.ts`) and this file lazy-imports that single artifact. The dynamic
 * import also guarantees the timezone override below runs first.
 *
 * Vercel reserves the `TZ` env var (functions run in UTC), but the local-day
 * bucketing (study-plan, analytics) follows the process timezone — `ENGRAM_TZ`
 * carries the user's timezone instead, and assigning `process.env.TZ`
 * invalidates V8's cached zone before any date work happens.
 *
 * The default export exposes a `fetch` method: Vercel detects that shape as a
 * Web handler (a bare default-exported function would be treated as a legacy
 * `(req, res)` Node handler). `vercel.json` rewrites `/api/(.*)` to this
 * function with the original URL preserved, which Hono's `/api/*` routes match
 * directly.
 */
if (process.env.ENGRAM_TZ) {
  process.env.TZ = process.env.ENGRAM_TZ
}

type AppModule = {
  app: { fetch: (request: Request) => Response | Promise<Response> }
}

let appModule: Promise<AppModule> | undefined

export default {
  async fetch(request: Request): Promise<Response> {
    appModule ??= import('./app.bundle.mjs')
    const { app } = await appModule
    return app.fetch(request)
  },
}
