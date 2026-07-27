import { lazy, memo, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/lib/utils'

/**
 * KaTeX is ~300 kB + fonts, so it never touches the base pipeline. It lives in a
 * separate module loaded lazily and ONLY when a card actually contains math
 * (spec §1). Math-free content keeps the exact previous pipeline at zero cost.
 */
const MarkdownMath = lazy(() => import('./markdown-math'))

/**
 * Cheap pre-parse heuristic to decide whether to pull the KaTeX chunk: a pair of
 * unescaped `$` delimiters (covers both `$…$` inline and `$$…$$` block, whose
 * adjacent opening `$$` already matches). Prose with a single `$` (a price)
 * never triggers a load; a rare false positive like "$5 to $10" only costs the
 * chunk, never correctness. Kept as a `test()` (no allocation) on every render.
 */
const MATH_HINT = /\$[^$]*\$/

// Spacing + horizontal scroll for display math so a wide matrix never blows out
// the card width. KaTeX inherits `currentColor`, so no theme rule is needed.
const KATEX_PROSE =
  '[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-0.5'

/**
 * Reusable, XSS-safe Markdown renderer (spec §5). Rendered by `react-markdown`
 * (no `dangerouslySetInnerHTML`) with `remark-gfm` (tables, task lists,
 * strikethrough) and `rehype-sanitize` (defensive scrub of any raw HTML). Prose
 * styling is "maison" via token-aligned Tailwind descendant utilities — no
 * `@tailwindcss/typography`, to stay inside the design system (§5.3).
 *
 * Shared (not in `features/review/`) because Phase 3 reuses it for the AI
 * generation preview. Memoized: a card's content never changes while shown.
 */

/**
 * Prose lives in three DISJOINT constants, never stacked: `PROSE_COMMON` (what
 * does not depend on the type scale) plus exactly one of `PROSE_UI` /
 * `PROSE_CARD`. `cn` is clsx + tailwind-merge, and tailwind-merge does not
 * reliably de-duplicate arbitrary variants (`[&_p]:text-base` vs
 * `[&_p]:text-card`), so layering one scale over the other would leave the
 * winner up to the order of the generated CSS. Splitting is the only safe form.
 */

// Scale-independent: colors, borders, weights, em-relative metrics (§5.3).
const PROSE_COMMON = [
  // Headings — Inter 600; sizes and vertical rhythm belong to the variants.
  '[&_h1]:font-semibold [&_h1]:tracking-[-0.01em]',
  '[&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  // Inline emphasis.
  '[&_strong]:font-semibold [&_strong]:text-text [&_em]:italic',
  '[&_del]:text-text-faint [&_del]:line-through',
  // Inline code + fenced blocks (JetBrains Mono, surface-3).
  '[&_code]:rounded-xs [&_code]:bg-surface-3 [&_code]:px-[0.3em] [&_code]:py-[0.05em] [&_code]:font-mono',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:leading-relaxed',
  // Lists.
  '[&_ul]:list-disc [&_ol]:list-decimal [&_li]:marker:text-text-muted',
  '[&_li_input]:mr-1.5 [&_li_input]:align-middle',
  // Tables (GFM) — hairlines, surface-3 header.
  '[&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface-3 [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  // Blockquote, links, rules, images.
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:text-text-muted',
  '[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline',
  '[&_hr]:border-border',
  '[&_img]:max-w-full [&_img]:rounded-md',
  // Alignment guardrails: `align="center"` centers prose, never the blocks whose
  // readability depends on a left edge (code, cells, list items).
  '[&_pre]:text-left [&_th]:text-left [&_td]:text-left [&_li]:text-left',
].join(' ')

// Chrome scale — anchored on 14px, dense. The default everywhere but the card.
const PROSE_UI = [
  '[&_h1]:text-lg [&_h1]:mt-3 [&_h1]:mb-1.5',
  '[&_h2]:text-base [&_h2]:mt-3 [&_h2]:mb-1.5',
  '[&_h3]:text-sm [&_h3]:mt-2.5 [&_h3]:mb-1',
  '[&_h4]:text-sm [&_h4]:text-text-muted [&_h4]:mt-2 [&_h4]:mb-1',
  '[&_p]:my-2 [&_p]:leading-[1.55] [&_:first-child]:mt-0 [&_:last-child]:mb-0',
  '[&_code]:text-[0.85em]',
  '[&_pre]:my-2 [&_pre]:p-3 [&_pre_code]:text-xs',
  '[&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_table]:my-2 [&_table]:text-xs',
  '[&_blockquote]:my-2 [&_blockquote]:pl-3',
  '[&_hr]:my-3',
].join(' ')

// Card reading scale — anchored on 17px/1.6, looser rhythm, its own register.
const PROSE_CARD = [
  'text-card leading-[1.6]',
  '[&_h1]:text-card-lg [&_h2]:text-card-md [&_h3]:text-card',
  '[&_h4]:text-card-sm [&_h4]:text-text-muted',
  '[&_p]:my-3 [&_p]:leading-[1.6] [&_:first-child]:mt-0 [&_:last-child]:mb-0',
  '[&_code]:text-[0.88em]',
  '[&_pre]:my-4 [&_pre]:p-4 [&_pre_code]:text-card-sm',
  '[&_ul]:my-3 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:pl-6',
  '[&_li]:my-1',
  '[&_table]:my-4 [&_table]:text-card-sm',
  '[&_blockquote]:my-4 [&_blockquote]:pl-4',
  // An image never eats the card.
  '[&_img]:mx-auto [&_img]:max-h-[45vh]',
].join(' ')

/** `ui` = the 14px chrome scale; `card` = the 17px reading scale. */
export type MarkdownVariant = 'ui' | 'card'
/** Prose alignment — `center` is the flashcard face (spec §4.4). */
export type MarkdownAlign = 'start' | 'center'

function MarkdownImpl({
  source,
  variant = 'ui',
  align = 'start',
  className,
}: {
  source: string
  variant?: MarkdownVariant
  align?: MarkdownAlign
  className?: string
}) {
  const hasMath = MATH_HINT.test(source)
  return (
    <div
      className={cn(
        'text-text',
        PROSE_COMMON,
        variant === 'card' ? PROSE_CARD : PROSE_UI,
        KATEX_PROSE,
        align === 'center' && 'text-center',
        className,
      )}
    >
      {hasMath ? (
        // Fallback = the plain pipeline so the card text is visible instantly and
        // upgrades to rendered math once the (local, fast) chunk resolves.
        <Suspense fallback={<BaseMarkdown source={source} />}>
          <MarkdownMath source={source} />
        </Suspense>
      ) : (
        <BaseMarkdown source={source} />
      )}
    </div>
  )
}

function BaseMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
      {source}
    </ReactMarkdown>
  )
}

export const Markdown = memo(MarkdownImpl)
