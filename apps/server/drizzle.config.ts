import { defineConfig } from 'drizzle-kit'
import { resolveDbFilePath } from './src/db/paths'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: resolveDbFilePath() },
  strict: true,
  verbose: true,
})
