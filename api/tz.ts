/**
 * Vercel reserves the `TZ` environment variable (functions always run in UTC),
 * but the local-day bucketing (study-plan, analytics) follows the process
 * timezone. `ENGRAM_TZ` lets deployments pick the user's timezone: assigning
 * `process.env.TZ` invalidates V8's cached timezone, so every later local-date
 * call uses it. This module MUST be imported before anything touches dates —
 * hence the dedicated file, first in `api/index.ts`'s import order.
 */
if (process.env.ENGRAM_TZ) {
  process.env.TZ = process.env.ENGRAM_TZ
}
