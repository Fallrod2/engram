import { createHmac, timingSafeEqual } from 'node:crypto'
import { CODEX_DEVICE_EXPIRES_IN_SECONDS } from './codex-constants'

/**
 * Stateless link handle (audit B5). `link/start` and `link/poll` may hit
 * DIFFERENT serverless instances (Vercel), so the device_auth_id can NOT live in
 * process memory. Instead the handle is an OPAQUE, HMAC-signed blob that
 * round-trips through the client, carrying `{ deviceAuthId, userCode, userId, exp }`.
 *
 * It is BOUND to the caller's userId: `open()` rejects a handle presented by a
 * different user, so a stolen handle can never link the victim's tokens to an
 * attacker's account. No new table, no server state.
 *
 * The user_code also travels to the client already (it is displayed), so this is
 * an integrity/binding mechanism, not confidentiality — HMAC (not encryption) is
 * the right tool.
 */

interface HandlePayload {
  deviceAuthId: string
  userCode: string
  userId: string
  /** ms-epoch expiry (matches the 15-min device poll cap). */
  exp: number
}

/**
 * The signing key. Prefers a dedicated secret, then the Supabase JWT secret
 * (present in enforced prod). Falls back to a fixed dev constant ONLY when
 * neither is set (local/e2e, where handles never leave the machine).
 */
function signingKey(): string {
  return (
    process.env.ENGRAM_CODEX_HANDLE_SECRET ||
    process.env.SUPABASE_JWT_SECRET ||
    'engram-dev-codex-handle-secret'
  )
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(body: string): string {
  return b64url(createHmac('sha256', signingKey()).update(body).digest())
}

/** Seal `{ deviceAuthId, userCode }` for `userId` into an opaque handle string. */
export function sealHandle(args: {
  deviceAuthId: string
  userCode: string
  userId: string
}): string {
  const payload: HandlePayload = {
    deviceAuthId: args.deviceAuthId,
    userCode: args.userCode,
    userId: args.userId,
    exp: Date.now() + CODEX_DEVICE_EXPIRES_IN_SECONDS * 1000,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  return `${body}.${sign(body)}`
}

/**
 * Open a handle for `userId`: verifies the HMAC (constant-time), the user binding
 * and the expiry. Returns the device args, or null if invalid/expired/mismatched.
 */
export function openHandle(
  handle: string,
  userId: string,
): { deviceAuthId: string; userCode: string } | null {
  const dot = handle.indexOf('.')
  if (dot <= 0) return null
  const body = handle.slice(0, dot)
  const mac = handle.slice(dot + 1)

  const expected = sign(body)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload: HandlePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as HandlePayload
  } catch {
    return null
  }
  if (payload.userId !== userId) return null // binding: reject another user's handle
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  if (!payload.deviceAuthId || !payload.userCode) return null
  return { deviceAuthId: payload.deviceAuthId, userCode: payload.userCode }
}
