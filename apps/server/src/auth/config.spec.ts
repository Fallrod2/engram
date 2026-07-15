import { describe, expect, it } from 'bun:test'
import { resolveAuthConfig, resolveAdminUserId } from './config'

/**
 * `resolveAuthConfig` matrix (spec §2.3/§6.1). A PURE function that NEVER throws
 * — every case just passes a literal env object (no `process.env` mutation).
 */
describe('resolveAuthConfig', () => {
  it('empty env → OFF, not misconfigured', () => {
    const cfg = resolveAuthConfig({})
    expect(cfg.enforced).toBe(false)
    expect(cfg.misconfigured).toBe(false)
    expect(cfg.bypassActive).toBe(false)
  })

  it('ENGRAM_AUTH_DISABLED=1 alone → OFF, bypassActive', () => {
    const cfg = resolveAuthConfig({ ENGRAM_AUTH_DISABLED: '1' })
    expect(cfg.enforced).toBe(false)
    expect(cfg.bypassActive).toBe(true)
    expect(cfg.misconfigured).toBe(false)
  })

  it('SUPABASE_URL set → ON', () => {
    const cfg = resolveAuthConfig({ SUPABASE_URL: 'https://x.supabase.co' })
    expect(cfg.enforced).toBe(true)
    expect(cfg.supabaseUrl).toBe('https://x.supabase.co')
  })

  it('VITE_SUPABASE_URL alone also configures the server → ON', () => {
    const cfg = resolveAuthConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })
    expect(cfg.enforced).toBe(true)
    expect(cfg.supabaseUrl).toBe('https://x.supabase.co')
  })

  it('dev: SUPABASE_URL + ENGRAM_AUTH_DISABLED=1 → OFF, bypassActive', () => {
    const cfg = resolveAuthConfig({
      SUPABASE_URL: 'https://x.supabase.co',
      ENGRAM_AUTH_DISABLED: '1',
    })
    expect(cfg.enforced).toBe(false)
    expect(cfg.bypassActive).toBe(true)
  })

  it('prod (VERCEL): SUPABASE_URL + ENGRAM_AUTH_DISABLED=1 → ON (bypass ignored)', () => {
    const cfg = resolveAuthConfig({
      SUPABASE_URL: 'https://x.supabase.co',
      ENGRAM_AUTH_DISABLED: '1',
      VERCEL: '1',
    })
    expect(cfg.enforced).toBe(true)
    expect(cfg.bypassActive).toBe(false)
  })

  it('prod (NODE_ENV=production, non-Vercel): bypass no longer honoured → ON (audit §7)', () => {
    const cfg = resolveAuthConfig({
      SUPABASE_URL: 'https://x.supabase.co',
      ENGRAM_AUTH_DISABLED: '1',
      NODE_ENV: 'production',
    })
    expect(cfg.enforced).toBe(true)
    expect(cfg.bypassActive).toBe(false)
  })

  it('prod (VERCEL) without config → misconfigured, no throw (audit §6)', () => {
    const cfg = resolveAuthConfig({ VERCEL: '1' })
    expect(cfg.enforced).toBe(false)
    expect(cfg.misconfigured).toBe(true)
  })

  it('prod (NODE_ENV=production) without config → misconfigured', () => {
    const cfg = resolveAuthConfig({ NODE_ENV: 'production' })
    expect(cfg.misconfigured).toBe(true)
  })

  it('SUPABASE_JWT_SECRET alone → ON (HS256 path)', () => {
    const cfg = resolveAuthConfig({ SUPABASE_JWT_SECRET: 'shhh' })
    expect(cfg.enforced).toBe(true)
    expect(cfg.jwtSecret).toBe('shhh')
  })
})

/** `resolveAdminUserId` — the env anti-lockout filet (spec §2.2, amendment A9). */
describe('resolveAdminUserId', () => {
  it('bypass/dev (not enforced): the dev identity is the admin', () => {
    const cfg = resolveAuthConfig({})
    expect(resolveAdminUserId(cfg)).toBe('dev-user')
  })

  it('bypass with an explicit admin id: that id wins over the dev default', () => {
    const cfg = resolveAuthConfig({ ENGRAM_ADMIN_USER_ID: 'root' })
    expect(resolveAdminUserId(cfg)).toBe('root')
  })

  it('enforced with an admin id: strictly that id', () => {
    const cfg = resolveAuthConfig({ SUPABASE_JWT_SECRET: 'shhh', ENGRAM_ADMIN_USER_ID: 'root' })
    expect(resolveAdminUserId(cfg)).toBe('root')
  })

  it('enforced WITHOUT an admin id: undefined (no env filet — DB roles only)', () => {
    const cfg = resolveAuthConfig({ SUPABASE_JWT_SECRET: 'shhh' })
    expect(resolveAdminUserId(cfg)).toBeUndefined()
  })
})
