import { app } from './app'

const port = 3001

console.log(`engram server listening on http://localhost:${port}`)

// Bun serves the default export when it exposes `fetch` + `port`.
export default {
  port,
  fetch: app.fetch,
}
