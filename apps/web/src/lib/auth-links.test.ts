import { describe, expect, it } from 'vitest'
import { parseAuthLinkParams, readAuthLink } from './auth-links'

/**
 * Pure parsing of Supabase invite/recovery callbacks. GoTrue's implicit flow puts
 * the result in the URL fragment; expired/used links come back as an error.
 */
describe('parseAuthLinkParams', () => {
  it('parses an invite token fragment', () => {
    const hash =
      '#access_token=aaa.bbb.ccc&refresh_token=r123&expires_in=3600&token_type=bearer&type=invite'
    expect(parseAuthLinkParams(hash)).toEqual({
      kind: 'tokens',
      accessToken: 'aaa.bbb.ccc',
      refreshToken: 'r123',
      type: 'invite',
    })
  })

  it('parses a recovery token fragment', () => {
    const hash = '#access_token=tok&refresh_token=ref&type=recovery'
    expect(parseAuthLinkParams(hash)).toEqual({
      kind: 'tokens',
      accessToken: 'tok',
      refreshToken: 'ref',
      type: 'recovery',
    })
  })

  it('parses an expired/used-link error fragment', () => {
    const hash =
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    expect(parseAuthLinkParams(hash)).toEqual({
      kind: 'error',
      error: 'access_denied',
      code: 'otp_expired',
      description: 'Email link is invalid or has expired',
    })
  })

  it('accepts a raw string without the leading # or ?', () => {
    expect(parseAuthLinkParams('access_token=t&refresh_token=r&type=invite')).toMatchObject({
      kind: 'tokens',
      type: 'invite',
    })
  })

  it('ignores an unknown type', () => {
    expect(parseAuthLinkParams('#access_token=t&refresh_token=r&type=signup')).toBeNull()
  })

  it('ignores a token fragment missing the refresh token', () => {
    expect(parseAuthLinkParams('#access_token=t&type=invite')).toBeNull()
  })

  it('ignores a normal anchor / empty input', () => {
    expect(parseAuthLinkParams('#section-2')).toBeNull()
    expect(parseAuthLinkParams('')).toBeNull()
  })
})

describe('readAuthLink', () => {
  it('prefers the fragment over the query', () => {
    expect(
      readAuthLink({
        hash: '#access_token=t&refresh_token=r&type=recovery',
        search: '?error=access_denied&error_code=otp_expired',
      }),
    ).toMatchObject({ kind: 'tokens', type: 'recovery' })
  })

  it('falls back to the query for an error', () => {
    expect(
      readAuthLink({ hash: '', search: '?error=access_denied&error_code=otp_expired' }),
    ).toMatchObject({ kind: 'error', code: 'otp_expired' })
  })

  it('returns null when neither carries an auth link', () => {
    expect(readAuthLink({ hash: '#top', search: '?tab=1' })).toBeNull()
  })
})
