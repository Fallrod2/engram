/**
 * Minimal, dependency-free Markdown helpers (spec §4). Phase 1 keeps preview
 * "léger" — the rich rendering of card faces is a Phase 2/3 concern. Everything
 * here is pure and unit-tested; the safe React renderer lives in `markdown.tsx`.
 */

/**
 * Flatten Markdown source to a single inline text line for dense table cells:
 * strips the common inline/block marks, collapses whitespace, joins lines.
 * Never produces HTML — it only ever removes characters.
 */
export function flattenMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s{0,3}>\s?/gm, '') // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // bullet markers
    .replace(/^\s{0,3}\d+\.\s+/gm, '') // ordered markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$2') // strikethrough
    .replace(/\s+/g, ' ')
    .trim()
}
