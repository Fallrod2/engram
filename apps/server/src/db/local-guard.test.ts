import { describe, expect, it } from 'vitest'
import { assertLocalDatabaseUrl, describeDatabaseHost, isLocalDatabaseUrl } from './local-guard'

const CLOUD_URL = 'postgresql://postgres.abcdef:hunter2@eu-west-3.pooler.supabase.com:6543/postgres'

describe('isLocalDatabaseUrl', () => {
  it.each([
    ['postgresql://postgres:postgres@127.0.0.1:54322/postgres'],
    ['postgresql://postgres:postgres@localhost:5432/engram'],
    ['postgresql://postgres:postgres@[::1]:5433/postgres'],
    // The point of the fix: a local instance on an unusual port is still local.
    ['postgresql://postgres:postgres@127.0.0.1:15432/postgres'],
    // No explicit port at all.
    ['postgresql://postgres:postgres@localhost/postgres'],
  ])('accepts the local instance %s', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true)
  })

  it.each([
    [CLOUD_URL],
    ['postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres'],
    // A remote host on the local stack's port must NOT pass.
    ['postgresql://u:p@10.0.0.7:54322/postgres'],
    // A host that merely looks local.
    ['postgresql://u:p@localhost.evil.com:54322/db'],
    ['not a url'],
    [''],
  ])('refuses the non-local instance %s', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false)
  })
})

describe('describeDatabaseHost', () => {
  it('names host and port without leaking the credentials', () => {
    expect(describeDatabaseHost(CLOUD_URL)).toBe('eu-west-3.pooler.supabase.com:6543')
    expect(describeDatabaseHost(CLOUD_URL)).not.toContain('hunter2')
  })

  it('marks a missing port and an unparsable string', () => {
    expect(describeDatabaseHost('postgresql://u:p@localhost/db')).toBe('localhost:(default port)')
    expect(describeDatabaseHost('nonsense')).toBe('an unparsable connection string')
  })
})

describe('assertLocalDatabaseUrl', () => {
  it('passes for any local port', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5433/postgres', 'db:reset'),
    ).not.toThrow()
  })

  it('refuses the cloud project with a diagnosable message', () => {
    expect(() => assertLocalDatabaseUrl(CLOUD_URL, 'db:reset')).toThrow(/^db:reset refused/)
    expect(() => assertLocalDatabaseUrl(CLOUD_URL, 'db:reset')).toThrow(
      /eu-west-3\.pooler\.supabase\.com:6543/,
    )
    expect(() => assertLocalDatabaseUrl(CLOUD_URL, 'db:reset')).toThrow(/DATABASE_URL/)
  })

  it('never echoes the password', () => {
    let message = ''
    try {
      assertLocalDatabaseUrl(CLOUD_URL, 'db:reset')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toContain('hunter2')
  })

  it('names the variable the caller actually reads', () => {
    expect(() =>
      assertLocalDatabaseUrl(CLOUD_URL, 'generate-landing-shots', 'LANDING_DATABASE_URL'),
    ).toThrow(/LANDING_DATABASE_URL/)
  })
})
