import { decodeJwt } from 'jose'
import {
  CODEX_ACCOUNT_ID_CLAIM,
  CODEX_CLIENT_ID,
  codexDeviceTokenUrl,
  codexOauthTokenUrl,
  codexRedirectUri,
  codexUsercodeUrl,
} from './codex-constants'
import { defaultFetch } from './constants'
import type { FetchFn } from './types'

/**
 * The verified Codex device-code flow (see `codex-constants.ts` for sources).
 * Every function is pure w.r.t. an injected `fetchFn` (default `globalThis.fetch`)
 * so the whole flow is unit-testable and the gate suite NEVER touches the network.
 * NONE of these functions log — tokens are secret end to end.
 */

/** Result of the device-code initiation. `interval` is serialized as a STRING upstream. */
export interface DeviceAuthStart {
  deviceAuthId: string
  userCode: string
  /** Poll interval hint (seconds); best-effort, upstream sends it as a string. */
  intervalSeconds: number
}

/** The token set persisted for a linked account. */
export interface CodexTokens {
  accessToken: string
  refreshToken: string | undefined
  /** `chatgpt_account_id` claim, required as the `chatgpt-account-id` backend header. */
  accountId: string | undefined
  /** Derived from the access token JWT `exp` claim (ms epoch), or undefined. */
  expiresAt: Date | undefined
}

/** Poll outcomes. `pending` = keep polling; the rest are terminal. */
export type DeviceAuthPoll =
  { status: 'pending' } | { status: 'linked'; tokens: CodexTokens } | { status: 'denied' }

/** A refresh outcome the caller maps to persist / keep / unlink. */
export type CodexRefresh =
  | { status: 'ok'; tokens: CodexTokens }
  | { status: 'invalid_grant' } // token revoked → unlink
  | { status: 'error'; httpStatus?: number } // transient (network/5xx) → keep

/**
 * Raised when device-code login is disabled on the account — the ONE honest
 * signal is an init 404 on the correct `/api/accounts/deviceauth/usercode` URL.
 */
export class DeviceAuthDisabledError extends Error {
  constructor() {
    super('codex device auth disabled')
    this.name = 'DeviceAuthDisabledError'
  }
}

/**
 * Raised when the init endpoint fails for any reason OTHER than a 404 (a 5xx, a
 * 4xx that is not 404, or a 200 with a missing body). Carries the upstream HTTP
 * status so the route can report an honest `upstream_error` instead of blaming
 * the user's account settings.
 */
export class DeviceAuthUpstreamError extends Error {
  constructor(readonly httpStatus: number) {
    super(`codex device auth init failed (HTTP ${httpStatus})`)
    this.name = 'DeviceAuthUpstreamError'
  }
}

/** Step 1 — initiate: POST `{ client_id }` → `{ device_auth_id, user_code, interval }`. */
export async function startDeviceAuth(fetchFn: FetchFn = defaultFetch): Promise<DeviceAuthStart> {
  const res = await fetchFn(codexUsercodeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  })
  if (!res.ok) {
    // 404 is the ONLY status that means "device login disabled on the account".
    // Everything else is an upstream failure, reported honestly (not a false
    // "enable the toggle" — the prod bug that started this fix).
    if (res.status === 404) throw new DeviceAuthDisabledError()
    throw new DeviceAuthUpstreamError(res.status)
  }
  const json = (await res.json()) as {
    device_auth_id?: string
    user_code?: string
    interval?: string | number
  }
  if (!json.device_auth_id || !json.user_code) {
    // A 200 with an unusable body is an upstream contract breach, not a disabled
    // account. Report it honestly (status 200) rather than blaming the toggle.
    throw new DeviceAuthUpstreamError(res.status)
  }
  const intervalSeconds = Number(json.interval)
  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 5,
  }
}

/**
 * Step 2+3 — poll then, on success, exchange the code SERVER-SIDE (same request).
 * Pending = HTTP 403/404. Success body = `{ authorization_code, code_verifier }`;
 * we immediately POST the form-urlencoded exchange to `oauth/token`.
 */
export async function pollDeviceAuth(
  args: { deviceAuthId: string; userCode: string },
  fetchFn: FetchFn = defaultFetch,
): Promise<DeviceAuthPoll> {
  const res = await fetchFn(codexDeviceTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: args.deviceAuthId, user_code: args.userCode }),
  })
  if (res.status === 403 || res.status === 404) return { status: 'pending' }
  if (!res.ok) return { status: 'denied' }

  const json = (await res.json()) as { authorization_code?: string; code_verifier?: string }
  if (!json.authorization_code || !json.code_verifier) return { status: 'denied' }

  const tokens = await exchangeCode(json.authorization_code, json.code_verifier, fetchFn)
  return tokens ? { status: 'linked', tokens } : { status: 'denied' }
}

/** Step 3 — code → tokens (form-urlencoded). Returns undefined on failure. */
async function exchangeCode(
  authorizationCode: string,
  codeVerifier: string,
  fetchFn: FetchFn,
): Promise<CodexTokens | undefined> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: codexRedirectUri(),
    client_id: CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
  })
  const res = await fetchFn(codexOauthTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!res.ok) return undefined
  const json = (await res.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) return undefined
  return buildTokens(json)
}

/**
 * Refresh: POST JSON `{ client_id, grant_type:'refresh_token', refresh_token }`.
 * All response fields are OPTIONAL (rotation). Distinguishes `invalid_grant`
 * (revoked → unlink) from a transient error (keep the credential).
 */
export async function refreshTokens(
  refreshToken: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<CodexRefresh> {
  let res: Response
  try {
    res = await fetchFn(codexOauthTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })
  } catch {
    return { status: 'error' } // network → transient, keep the credential
  }
  if (res.status === 400 || res.status === 401) {
    // The OAuth server signals a revoked/invalid refresh token with 400/401.
    return { status: 'invalid_grant' }
  }
  if (!res.ok) return { status: 'error', httpStatus: res.status }

  const json = (await res.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) return { status: 'error', httpStatus: res.status }
  // Preserve the old refresh token when the response omits a rotated one.
  const tokens = buildTokens(json)
  if (tokens.refreshToken === undefined) tokens.refreshToken = refreshToken
  return { status: 'ok', tokens }
}

/** Assemble a `CodexTokens` from an OAuth JSON body, deriving account id + expiry. */
function buildTokens(json: {
  id_token?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
}): CodexTokens {
  const accessToken = json.access_token ?? ''
  return {
    accessToken,
    refreshToken: json.refresh_token,
    accountId: json.id_token ? claimAccountId(json.id_token) : undefined,
    expiresAt: deriveExpiresAt(accessToken, json.expires_in),
  }
}

/** Read `chatgpt_account_id` from an id_token (decode only — never verified here). */
export function claimAccountId(idToken: string): string | undefined {
  try {
    const claims = decodeJwt(idToken) as Record<string, unknown>
    const v = claims[CODEX_ACCOUNT_ID_CLAIM]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * Derive the access-token expiry: prefer the JWT `exp` claim (the exchange does
 * not surface an `expires_in` the CLI uses); fall back to `expires_in`; else a
 * conservative 1h default so a fresh link is never treated as already-expired.
 */
export function deriveExpiresAt(accessToken: string, expiresIn?: number): Date | undefined {
  try {
    const claims = decodeJwt(accessToken) as { exp?: number }
    if (typeof claims.exp === 'number' && claims.exp > 0) return new Date(claims.exp * 1000)
  } catch {
    /* not a JWT / undecodable → fall through */
  }
  if (typeof expiresIn === 'number' && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000)
  }
  return new Date(Date.now() + 60 * 60 * 1000)
}
