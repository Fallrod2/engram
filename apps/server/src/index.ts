import { app } from './app'

const port = 3001

// All day/week bucketing (analytics + planning) assumes the process runs in the
// user's timezone. Log the resolved TZ so that assumption is auditable; if
// engram is ever containerized, set `TZ` explicitly to the user's zone.
console.log('[engram] timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone)
console.log(`engram server listening on http://localhost:${port}`)

// Bun serves the default export when it exposes `fetch` + `port`.
export default {
  port,
  fetch: app.fetch,
}
