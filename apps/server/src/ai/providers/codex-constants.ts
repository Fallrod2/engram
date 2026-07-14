/**
 * OpenAI Codex (ChatGPT subscription) OAuth device-code contract.
 *
 * ⚠️ This is NOT a generic RFC 8628 device flow. It is the proprietary 3-step
 * flow of the Codex CLI, frozen here from the verified upstream sources below
 * (fetched & confirmed 2026-07-14). The user's REAL subscription test is Alex's
 * job — everything in the test/gate suite runs against a LOCAL MOCK server.
 *
 * Sources (verified online 2026-07-14):
 * - developers.openai.com/codex/auth — device-code beta, must be enabled in
 *   ChatGPT → Settings → Security → "Allow device code login".
 * - openai/codex codex-rs/login/src/device_code_auth.rs + server.rs —
 *   `api_base_url = "{issuer}/api/accounts"`, so the device-code endpoints are
 *   `{issuer}/api/accounts/deviceauth/usercode` (init) +
 *   `{issuer}/api/accounts/deviceauth/token` (poll). Pending = HTTP 403/404;
 *   PKCE generated server-side and returned in the poll success body. The final
 *   `oauth/token` exchange and the `deviceauth/callback` redirect stay on the
 *   bare issuer (NO `/api/accounts`). Verified against the real host 2026-07-14:
 *   `POST {issuer}/api/accounts/deviceauth/usercode {client_id}` → 200 with
 *   `{ device_auth_id, user_code, interval:"5", expires_at }` (interval is a
 *   STRING). The old un-prefixed URLs 404'd — which the flow must read as
 *   "device login disabled on the account" ONLY for the init 404, nothing else.
 * - openai/codex codex-rs/login/src/server.rs — `oauth/token` exchange
 *   (form-urlencoded, authorization_code) + `chatgpt_account_id` id_token claim.
 * - openai/codex codex-rs/login/src/auth/manager.rs — refresh (JSON,
 *   grant_type=refresh_token, all response fields optional → rotation),
 *   CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES = 5.
 * - github.com/7shi/codex-oauth — client_id, backend-api/codex/responses,
 *   store:false, instructions required, input_text, chatgpt-account-id header.
 */

/** Public OAuth client id of the Codex CLI (reused by every third-party tool). */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/** Default base of the OpenAI auth host. */
const DEFAULT_AUTH_BASE = 'https://auth.openai.com'
/** Default backend "Responses" endpoint. */
const DEFAULT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/**
 * Auth base, overridable via `ENGRAM_CODEX_AUTH_BASE`. The ONLY use of the
 * override is the local MOCK server in the verification gate (§5) — production
 * always talks to the real host. Resolved at CALL TIME (not module load) so a
 * test/mock env is honoured. NEVER points at a real host in tests.
 */
export function codexAuthBase(): string {
  return (process.env.ENGRAM_CODEX_AUTH_BASE || DEFAULT_AUTH_BASE).replace(/\/+$/, '')
}

/**
 * Accounts API base: `{issuer}/api/accounts` (upstream `api_base_url`). The
 * device-code endpoints live here — the missing `/api/accounts` prefix was the
 * real prod bug (every init 404'd → false "disabled on this account").
 */
export function codexAccountsBase(): string {
  return `${codexAuthBase()}/api/accounts`
}

/** Device-code initiation: POST JSON `{ client_id }`. */
export function codexUsercodeUrl(): string {
  return `${codexAccountsBase()}/deviceauth/usercode`
}

/** Device-code polling: POST JSON `{ device_auth_id, user_code }`. */
export function codexDeviceTokenUrl(): string {
  return `${codexAccountsBase()}/deviceauth/token`
}

/** OAuth token endpoint — used for BOTH the code exchange and the refresh. */
export function codexOauthTokenUrl(): string {
  return `${codexAuthBase()}/oauth/token`
}

/** Redirect URI the code exchange must echo (constant, never actually hit). */
export function codexRedirectUri(): string {
  return `${codexAuthBase()}/deviceauth/callback`
}

/** Backend "Responses"-shaped endpoint, overridable via `ENGRAM_CODEX_RESPONSES_URL`. */
export function codexResponsesUrl(): string {
  return process.env.ENGRAM_CODEX_RESPONSES_URL || DEFAULT_RESPONSES_URL
}

/**
 * The page the user opens to authorize. The Codex CLI builds `{base}/codex/device`
 * (base = chatgpt.com); the user-facing doc also shows `auth.openai.com/device`.
 * openPoint: confirm the exact URL against a REAL account (Alex).
 */
export const CODEX_VERIFICATION_URI = 'https://chatgpt.com/codex/device'

/** The CLI hard-caps device polling at 15 minutes; no expires_in is returned. */
export const CODEX_DEVICE_EXPIRES_IN_SECONDS = 15 * 60

/** Refresh margin, aligned with the CLI (5 min before `exp`). */
export const CODEX_REFRESH_MARGIN_MS = 5 * 60 * 1000

/** Backend "Responses"-shaped endpoint served against the subscription. */
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/** Required backend headers (besides Authorization + chatgpt-account-id). */
export const CODEX_ORIGINATOR = 'codex_cli_rs'
export const CODEX_OPENAI_BETA = 'responses=experimental'

/** id_token claim carrying the account id required by the backend header. */
export const CODEX_ACCOUNT_ID_CLAIM = 'chatgpt_account_id'

/**
 * Static subscription model presets (no reliable list endpoint on the backend).
 * Drives the UI datalist; the user may type any model their plan exposes.
 * Source: docs/subscription-providers-research.md (07/2026 models).
 */
export const CODEX_MODELS: string[] = ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']

/** Default model for a freshly-linked codex config. */
export const CODEX_DEFAULT_MODEL = 'gpt-5.5'

/** Opt-in kill-switch: the provider is inert unless this env flag is exactly '1'. */
export const CODEX_ENABLE_ENV = 'ENGRAM_ENABLE_CODEX'
