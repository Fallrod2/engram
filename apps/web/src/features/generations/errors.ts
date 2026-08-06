import { ApiError, isDemoNoSpendError } from '@/lib/api'

/**
 * Error mapping for the Phase 3 flows (spec §1.5.bis). Pure + unit-tested: the
 * screens render the classification, they don't re-derive it.
 */

/** How the generation-launch / review screen should present a failure. */
export type GenerationErrorKind =
  | 'demoNoSpend' // 403 details.reason=demo_no_spend — the demo never bills a run
  | 'apiKeyMissing' // config warning, non-retryable-as-is (§1.5.bis-3)
  | 'notFound' // generation deleted / bad id → back link
  | 'generic' // everything else → inline retry / relaunch

/**
 * True iff a message marks the missing-Anthropic-key case. The server guards
 * with a 503 `service_unavailable` before creating a row; as a belt we also
 * detect a `failed` run whose `error` mentions the key (spec §1.3 alternative).
 * Never surfaces the key value itself.
 */
export function isApiKeyError(message: string | null | undefined): boolean {
  return message != null && /anthropic_api_key/i.test(message)
}

/** Classify a thrown error from `startGeneration` / a generation query. */
export function classifyGenerationError(err: unknown): GenerationErrorKind {
  // FIRST, and deliberately ahead of `apiKeyMissing`: the demo is refused by
  // POLICY, not by a missing key (T-058). Sending a demo visitor to Réglages to
  // configure a provider on an account that is not theirs is a true sentence and
  // a dead end — the way forward is the pre-recorded example, not a key.
  if (isDemoNoSpendError(err)) return 'demoNoSpend'
  if (err instanceof ApiError) {
    if (err.code === 'service_unavailable' || err.status === 503) return 'apiKeyMissing'
    if (err.code === 'not_found' || err.status === 404) return 'notFound'
    if (isApiKeyError(err.message)) return 'apiKeyMissing'
  }
  return 'generic'
}

/** A clear, actionable French message for a failed upload (spec §1.5.bis-1). */
export function describeUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'payload_too_large' || err.status === 413) {
      return 'Fichier trop volumineux (max 10 Mo)'
    }
    if (err.code === 'validation_error' || err.status === 400) {
      return 'Fichier illisible'
    }
  }
  return "L'import a échoué"
}
