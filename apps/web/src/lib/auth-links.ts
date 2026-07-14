/**
 * Pure parsing of Supabase email-link callbacks (invite / password recovery).
 *
 * GoTrue's implicit flow redirects the browser to our `site_url` with the result
 * in the URL **fragment**, e.g.
 *   `…/#access_token=…&refresh_token=…&expires_in=3600&token_type=bearer&type=invite`
 * and, when the one-time token is expired or already used, an error fragment
 *   `…/#error=access_denied&error_code=otp_expired&error_description=…`.
 *
 * The web client keeps `detectSessionInUrl:false` (spec §3.1) so supabase-js never
 * touches the URL on arbitrary page loads — the guard logic stays simple and no
 * surprise session is minted from a stray deep-link. Instead we parse the fragment
 * ourselves, once, at bootstrap (`captureAuthLink`), then strip it from the URL so
 * the token never lingers in history. These functions are pure and unit-tested.
 */

/**
 * `signup` is the email-confirmation callback of the public sign-up flow (spec
 * BYOK §2): the password is ALREADY set, so — unlike invite/recovery — it does
 * NOT gate the `/set-password` screen; once the session is established it is a
 * normal login (see `auth-store.ts` `init()`).
 */
export type AuthLinkType = 'invite' | 'recovery' | 'signup'

export interface AuthLinkTokens {
  kind: 'tokens'
  accessToken: string
  refreshToken: string
  type: AuthLinkType
}

export interface AuthLinkError {
  kind: 'error'
  error: string
  code: string | null
  description: string | null
}

export type AuthLinkResult = AuthLinkTokens | AuthLinkError

/** Keys we consider "ours" and strip from the URL after capture. */
export const AUTH_LINK_PARAM_KEYS = [
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'type',
  'provider_token',
  'provider_refresh_token',
  'error',
  'error_code',
  'error_description',
] as const

function toParams(raw: string): URLSearchParams {
  const trimmed = raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw
  return new URLSearchParams(trimmed)
}

function isLinkType(value: string | null): value is AuthLinkType {
  return value === 'invite' || value === 'recovery' || value === 'signup'
}

/**
 * Parse a single fragment/query string into a token or error result. `null` when
 * it is not a recognised invite/recovery callback (so a normal `#section` anchor
 * or unrelated query is ignored).
 */
export function parseAuthLinkParams(raw: string): AuthLinkResult | null {
  if (!raw) return null
  const params = toParams(raw)

  const error = params.get('error') ?? params.get('error_code')
  if (error) {
    return {
      kind: 'error',
      error: params.get('error') ?? params.get('error_code') ?? 'access_denied',
      code: params.get('error_code'),
      description: params.get('error_description'),
    }
  }

  const type = params.get('type')
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (isLinkType(type) && accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken, type }
  }
  return null
}

/**
 * Read an invite/recovery callback from a location's fragment first, then its
 * query (GoTrue uses the fragment for the implicit flow, but some error paths land
 * in the query). Pure — the caller passes the raw `hash`/`search` strings.
 */
export function readAuthLink(loc: { hash: string; search: string }): AuthLinkResult | null {
  return parseAuthLinkParams(loc.hash) ?? parseAuthLinkParams(loc.search)
}
