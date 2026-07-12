import { extractText as unpdfExtractText } from 'unpdf'
import type { SourceType } from '@engram/shared'
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
