import { describe, expect, it } from 'bun:test'

/**
 * Import-without-throw guard (audit §6). `app.ts` mounts the auth middleware but
 * resolves NO config at its top level, so importing it must never throw — not
 * even in a prod-shaped, unconfigured env (where the fail-closed path only fires
 * at request time, inside the middleware). Env is restored so nothing leaks into
 * the route specs sharing this bun process (they must keep running auth OFF).
 */
describe('app module import', () => {
  it('does not throw at import even when prod & unconfigured', async () => {
    const prevVercel = process.env.VERCEL
    const prevUrl = process.env.SUPABASE_URL
    const prevSecret = process.env.SUPABASE_JWT_SECRET
    process.env.VERCEL = '1'
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_JWT_SECRET
    try {
      const mod = await import('./app')
      expect(typeof mod.app.fetch).toBe('function')

      // Even prod-misconfigured, /api/health stays readable and self-reports
      // authEnforced:false (spec §2.6) — that is the ops runbook for diagnosing
      // *why* every other route is 500ing after a bad deploy.
      const res = await mod.app.fetch(new Request('http://localhost/api/health'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { authEnforced: boolean }
      expect(body.authEnforced).toBe(false)
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = prevVercel
      if (prevUrl === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = prevUrl
      if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET
      else process.env.SUPABASE_JWT_SECRET = prevSecret
    }
  })
})
