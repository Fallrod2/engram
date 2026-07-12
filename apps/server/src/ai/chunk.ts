/** Character budget per chunk (keeps context focused, cost controlled). */
export const MAX_CHUNK_CHARS = 12_000
/** Hard cap on chunk count (bounds total cost/latency of a generation). */
export const MAX_CHUNKS = 20

/**
 * Split a text into chunks <= maxChars WITHOUT cutting mid-paragraph (boundary =
 * blank line). A single paragraph longer than maxChars is hard-split (fallback).
 * Always returns at least one chunk (never empty).
 */
export function chunkNote(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]

  const paragraphs = trimmed.split(/\n{2,}/)
  const chunks: string[] = []
  let cur = ''
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (cur) {
        chunks.push(cur)
        cur = ''
      }
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars))
      continue
    }
    const candidate = cur ? `${cur}\n\n${p}` : p
    if (candidate.length > maxChars) {
      if (cur) chunks.push(cur)
      cur = p
    } else {
      cur = candidate
    }
  }
  if (cur) chunks.push(cur)
  return chunks.slice(0, MAX_CHUNKS)
}
