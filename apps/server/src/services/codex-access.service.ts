import { and, eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { aiCredential } from '../db/schema'
import { CODEX_REFRESH_MARGIN_MS } from '../ai/providers/codex-constants'
import { refreshTokens } from '../ai/providers/codex-oauth'
import type { FetchFn } from '../ai/providers/types'

/** The fresh access the adapter needs: token + the required account-id header. */
export interface CodexAccess {
  accessToken: string
  accountId: string | undefined
}

/**
 * Resolve a USABLE codex access token for `(userId,'openai-codex')`, refreshing
 * it in-band when it is within the 5-min margin. Returns `null` when the account
 * is not linked or the refresh token was revoked (→ the caller 503s and the UI
 * status flips back to "not linked").
 *
 * Concurrency (audit B6): the read-decide-refresh-write runs inside a
 * transaction that takes a ROW LOCK (`FOR UPDATE`) on the credential and
 * RE-READS the expiry after acquiring it. Two concurrent resolvers (generation +
 * OCR, or two lambdas) therefore serialize: the first refreshes and rotates the
 * refresh token; the second, seeing a now-fresh expiry, reuses the stored token
 * instead of issuing a second refresh that would invalidate the first.
 *
 * Failure taxonomy (audit B8): a revoked token (`invalid_grant`) DELETES the
 * credential (real unlink); a transient network/5xx error KEEPS it and returns
 * null (a 503 that recovers on its own) — an OpenAI incident never unlinks
 * everyone.
 */
export async function resolveCodexAccess(
  db: DB,
  userId: string,
  fetchFn?: FetchFn,
): Promise<CodexAccess | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiCredential)
      .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, 'openai-codex')))
      .for('update')

    if (!row) return null

    const fresh =
      row.expiresAt !== null && row.expiresAt.getTime() - Date.now() > CODEX_REFRESH_MARGIN_MS
    // Still fresh (re-read after the lock → another writer may have refreshed).
    if (fresh) return { accessToken: row.secret, accountId: row.accountId ?? undefined }

    // Needs a refresh but we have no refresh token → try the current access as-is.
    if (!row.refreshToken) {
      return { accessToken: row.secret, accountId: row.accountId ?? undefined }
    }

    const result = fetchFn
      ? await refreshTokens(row.refreshToken, fetchFn)
      : await refreshTokens(row.refreshToken)

    if (result.status === 'invalid_grant') {
      // Revoked → hard unlink.
      await tx
        .delete(aiCredential)
        .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, 'openai-codex')))
      return null
    }
    if (result.status === 'error') {
      // Transient: keep the credential. If the stored token has not HARD-expired
      // yet (we only reached here inside the margin), still hand it out; else null.
      const hardExpired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()
      return hardExpired ? null : { accessToken: row.secret, accountId: row.accountId ?? undefined }
    }

    // Success → persist the rotated tokens (keep old refresh if omitted).
    const t = result.tokens
    await tx
      .update(aiCredential)
      .set({
        secret: t.accessToken,
        refreshToken: t.refreshToken ?? row.refreshToken,
        expiresAt: t.expiresAt ?? row.expiresAt,
        accountId: t.accountId ?? row.accountId,
        updatedAt: new Date(),
      })
      .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, 'openai-codex')))

    return { accessToken: t.accessToken, accountId: t.accountId ?? row.accountId ?? undefined }
  })
}
