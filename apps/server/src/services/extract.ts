import { extractText as unpdfExtractText } from 'unpdf'
import type { SourceType, VisionMediaType } from '@engram/shared'
import { ValidationError } from '../http/errors'

/** The metadata of an uploaded file needed to derive its source type. */
export interface UploadFileMeta {
  name: string
  type: string
}

/** `%PDF` — the first four bytes every PDF starts with. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false
  return PDF_MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * Derive the source type of an uploaded file, or null if unsupported.
 *
 * PDF wins on magic bytes (`%PDF`) — authoritative even when the extension is
 * misleading — or on an `application/pdf` MIME type. Otherwise MD is accepted
 * for text MIME types or `.md`/`.markdown`/`.txt` names.
 */
export function detectSourceType(meta: UploadFileMeta, bytes: Uint8Array): SourceType | null {
  if (hasPdfMagic(bytes) || meta.type === 'application/pdf') return 'pdf'

  const name = meta.name.toLowerCase()
  const mdName = name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')
  const mdType = meta.type === 'text/markdown' || meta.type === 'text/plain' || meta.type === ''
  if (mdName || mdType) return 'md'

  return null
}

// --- Image detection (photo-OCR path, spec §2.1) ---------------------------

/** `%PDF` etc. — a byte prefix check anchored at offset 0. */
function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  return sig.every((b, i) => bytes[offset + i] === b)
}

/** `ftyp` box brands that mark a HEIC/HEIF container (rejected, spec §1.1). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'])

/**
 * Detect a supported image from its MAGIC BYTES (authoritative over the
 * extension/MIME, exactly like PDF), returning the concrete media type needed
 * for the vision call. HEIC/HEIF is detected on purpose so the route can reject
 * it with an actionable message (spec §1.1); anything else is `null`.
 *
 * The `meta` param mirrors `detectSourceType`'s signature for call-site
 * symmetry, but the decision is byte-driven — a photo downscaled client-side is
 * re-encoded to JPEG, so the MIME cannot be trusted.
 */
export function detectImageMedia(
  _meta: UploadFileMeta,
  bytes: Uint8Array,
): { mediaType: VisionMediaType } | { heic: true } | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mediaType: 'image/jpeg' }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mediaType: 'image/png' }
  }
  // WebP: "RIFF" @ 0 and "WEBP" @ 8
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mediaType: 'image/webp' }
  }
  // HEIC/HEIF: "ftyp" @ 4, brand @ 8 (targeted rejection). Brand is ASCII.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) && bytes.length >= 12) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12)).toLowerCase()
    if (HEIF_BRANDS.has(brand)) return { heic: true }
  }
  return null
}

/**
 * Extract plain text from uploaded bytes. MD is UTF-8 decoded; PDF goes through
 * unpdf (merged pages). A PDF that unpdf cannot read → 400 `could not read PDF`.
 */
export async function extractText(bytes: Uint8Array, sourceType: SourceType): Promise<string> {
  if (sourceType === 'md') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
  try {
    const { text } = await unpdfExtractText(bytes, { mergePages: true })
    return text
  } catch {
    throw new ValidationError('could not read PDF')
  }
}
