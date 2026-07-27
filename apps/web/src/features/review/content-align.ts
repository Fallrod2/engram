import type { MarkdownAlign } from '@/components/markdown'

/**
 * Decide whether a Markdown block reads centered or aligned to the left.
 * Centering is only defensible for a short, structure-free fragment — a term, a
 * one-line question, a formula. As soon as there is a reading edge to hold, it
 * destroys the line return and costs on every saccade.
 * `front` and `back` are evaluated INDEPENDENTLY (a centered term above a
 * left-aligned definition is the normal case).
 */
const BLOCK_MARKUP = /^[ \t]{0,3}(?:[-*+][ \t]|\d+[.)][ \t]|>|\||#{1,6}[ \t]|```|~~~)/m
const DISPLAY_MATH = /\$\$/
/** ~2 full lines at 17px inside 616px of usable width. Beyond that, it needs a left edge. */
const CENTER_MAX_CHARS = 120

export function contentAlign(source: string): MarkdownAlign {
  const s = source.trim()
  if (s.length === 0) return 'center'
  if (s.length > CENTER_MAX_CHARS) return 'start'
  if (BLOCK_MARKUP.test(s)) return 'start'
  if (DISPLAY_MATH.test(s)) return 'start'
  if (s.includes('\n')) return 'start' // formatting the author asked for
  return 'center'
}
