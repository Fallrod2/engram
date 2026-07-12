import { defineConfig } from 'drizzle-kit'
import { resolveDatabaseUrl } from './src/db/paths'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: resolveDatabaseUrl() },
  strict: true,
  verbose: true,
})
