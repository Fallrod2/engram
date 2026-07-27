import { describe, expect, it } from 'vitest'
import { resolveE2eDatabaseUrl } from './db'

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const CLOUD_URL = 'postgresql://postgres.abcdef:hunter2@eu-west-3.pooler.supabase.com:6543/postgres'

describe('resolveE2eDatabaseUrl', () => {
  it('accepts a local E2E_DATABASE_URL on an arbitrary port', () => {
    const url = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: url })).toBe(url)
  })

  it('rejects a non-local E2E_DATABASE_URL and names the variable to set', () => {
    expect(() => resolveE2eDatabaseUrl({ E2E_DATABASE_URL: CLOUD_URL })).toThrow(/E2E_DATABASE_URL/)
    expect(() => resolveE2eDatabaseUrl({ E2E_DATABASE_URL: CLOUD_URL })).toThrow(
      /eu-west-3\.pooler\.supabase\.com:6543/,
    )
  })

  it('ignores a cloud DATABASE_URL and falls back to the local default', () => {
    // Alex's real dev setup: DATABASE_URL points at the Supabase cloud project.
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: CLOUD_URL })).toBe(DEFAULT_URL)
  })

  it('uses DATABASE_URL when it is local', () => {
    const url = 'postgresql://postgres:postgres@localhost:5432/engram'
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: url })).toBe(url)
  })

  it('prefers E2E_DATABASE_URL over a local DATABASE_URL', () => {
    const e2e = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'
    const app = 'postgresql://postgres:postgres@127.0.0.1:5432/engram'
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: e2e, DATABASE_URL: app })).toBe(e2e)
  })

  it('falls back to the historical default when neither variable is set', () => {
    expect(resolveE2eDatabaseUrl({})).toBe(DEFAULT_URL)
  })

  it('treats empty strings as unset', () => {
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: '', DATABASE_URL: '' })).toBe(DEFAULT_URL)
  })

  it.each([
    ['postgresql://postgres:postgres@localhost:54322/postgres'],
    ['postgresql://postgres:postgres@127.0.0.1:54322/postgres'],
    ['postgresql://postgres:postgres@[::1]:54322/postgres'],
  ])('accepts the local host form %s', (url) => {
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: url })).toBe(url)
  })

  it('rejects an unparsable E2E_DATABASE_URL with a readable message', () => {
    expect(() => resolveE2eDatabaseUrl({ E2E_DATABASE_URL: 'not a url' })).toThrow(
      /unparsable connection string/,
    )
  })

  it('ignores an unparsable DATABASE_URL instead of throwing', () => {
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: 'not a url' })).toBe(DEFAULT_URL)
  })

  it('rejects a host that merely looks local', () => {
    expect(() =>
      resolveE2eDatabaseUrl({ E2E_DATABASE_URL: 'postgresql://u:p@localhost.evil.com:5432/db' }),
    ).toThrow(/localhost\.evil\.com/)
  })

  it('explains that the harness creates and drops databases', () => {
    expect(() => resolveE2eDatabaseUrl({ E2E_DATABASE_URL: CLOUD_URL })).toThrow(/DROP/)
  })
})
