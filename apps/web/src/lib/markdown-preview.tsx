import { Fragment, type ReactNode } from 'react'

/**
 * A tiny, XSS-safe Markdown preview (spec §4 — "aperçu simple" in Phase 1).
 * It never uses `dangerouslySetInnerHTML`: inline marks are tokenized into
 * React nodes, so untrusted text can only ever render as text.
 *
 * Supported: paragraphs (blank-line separated), hard line breaks, `**bold**`,
 * `*italic*`/`_italic_`, `` `code` ``. Anything else renders as plain text.
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (
      (part.startsWith('**') && part.endsWith('**')) ||
      (part.startsWith('__') && part.endsWith('__'))
    ) {
      return (
        <strong key={key} className="font-semibold text-text">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (
      (part.startsWith('*') && part.endsWith('*')) ||
      (part.startsWith('_') && part.endsWith('_'))
    ) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded-xs bg-surface-2 px-1 font-mono text-[0.9em] text-text">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  const blocks = source.split(/\n{2,}/).filter((b) => b.trim().length > 0)
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        return (
          <p key={bi} className={bi > 0 ? 'mt-2' : undefined}>
            {lines.map((line, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(line, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
