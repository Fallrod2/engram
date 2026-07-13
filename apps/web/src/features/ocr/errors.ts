import { ApiError } from '@/lib/api'
import { DownscaleError } from './downscale'

/**
 * Error mapping for the photo-OCR flow (OCR spec §3.5). Pure + unit-tested: the
 * preview screen renders the classification, it never re-derives it.
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

/** A clear, actionable French message for a failed extraction. */
export function describeExtractError(err: unknown): string {
  switch (classifyExtractError(err)) {
    case 'noVisionProvider':
      return 'Extraction indisponible : aucun modèle de vision configuré. Choisissez un modèle vision (Claude, GPT-4o, llava…) dans les Réglages.'
    case 'heic':
      return 'Format HEIC non supporté. Réglez l’appareil photo iPhone sur « Le plus compatible » (JPEG), ou convertissez l’image.'
    case 'unsupported':
      return 'Image non supportée (formats acceptés : JPG, PNG, WebP).'
    case 'tooLarge':
      return 'Image trop volumineuse, même après réduction.'
    case 'illegible':
      return 'Aucun texte n’a pu être extrait de cette image.'
    case 'generic':
      return 'L’extraction a échoué.'
  }
}
