import { Markdown } from '@/components/markdown'

/**
 * Live preview for the card editors (composer + edit dialog). It now delegates
 * to the single shared `<Markdown>` renderer so the preview matches EXACTLY what
 * the card face will show — including GFM and lazily-rendered KaTeX math
 * (`$…$` / `$$…$$`, spec §1). Untrusted text stays XSS-safe (react-markdown,
 * never `dangerouslySetInnerHTML`; `rehype-sanitize` on every path).
 *
 * Previously a tiny bespoke tokenizer; unified here to kill the divergence
 * between the preview and the real card rendering.
 */
export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  // Conditional spread: `exactOptionalPropertyTypes` forbids passing an explicit
  // `className={undefined}` when the target types it as `className?: string`.
  return <Markdown source={source} {...(className !== undefined ? { className } : {})} />
}
