import type { TKey } from '@/lib/i18n'
import { ApiError } from '@/lib/api'
import { DownscaleError } from './downscale'

/**
 * Error mapping for the photo-OCR flow (OCR spec §3.5). Pure + unit-tested: the
 * preview screen renders the classification, it never re-derives it. This module
 * is non-React, so it returns i18n *codes/keys* — the message text lives in the
 * dictionary and is resolved at the display point (mirrors the AI test-connection
 * outcome codes).
 */
export type OcrErrorKind =
  | 'noVisionProvider' // 503 — no provider / no vision capability (config banner)
  | 'heic' // HEIC rejected (client filename or server magic bytes)
  | 'unsupported' // decode failed / non jpg-png-webp
  | 'tooLarge' // > 4 MB even after downscale, or server 413
  | 'illegible' // extraction empty / unreadable
  | 'generic' // everything else → per-page retry

export function classifyExtractError(err: unknown): OcrErrorKind {
  // Client-side downscale / pre-flight failures never round-trip.
  if (err instanceof DownscaleError) {
    if (err.code === 'heic') return 'heic'
    return err.code === 'tooLarge' ? 'tooLarge' : 'unsupported'
  }
  if (err instanceof ApiError) {
    if (err.code === 'service_unavailable' || err.status === 503) return 'noVisionProvider'
    if (err.code === 'payload_too_large' || err.status === 413) return 'tooLarge'
    if (err.code === 'validation_error' || err.status === 400) {
      const m = (err.message ?? '').toLowerCase()
      if (m.includes('heic')) return 'heic'
      if (m.includes('non supporté') || m.includes('non supporte')) return 'unsupported'
      // Remaining 400s on this endpoint mean "nothing readable".
      return 'illegible'
    }
  }
  return 'generic'
}

/** Dict key carrying a clear, actionable message for each failure kind. */
const MESSAGE_KEY: Record<OcrErrorKind, TKey> = {
  noVisionProvider: 'ocr.error.noVisionProvider',
  heic: 'ocr.error.heic',
  unsupported: 'ocr.error.unsupported',
  tooLarge: 'ocr.error.tooLarge',
  illegible: 'ocr.error.illegible',
  generic: 'ocr.error.generic',
}

/**
 * Dict key for a stored error kind. The reducer keeps the raw kind string (an
 * `OcrErrorKind` widened to `string`); this resolves it to a `TKey` at the
 * display point, falling back to the generic key for anything unrecognized.
 */
export function ocrErrorMessageKey(kind: string | undefined): TKey {
  return kind && kind in MESSAGE_KEY ? MESSAGE_KEY[kind as OcrErrorKind] : MESSAGE_KEY.generic
}
