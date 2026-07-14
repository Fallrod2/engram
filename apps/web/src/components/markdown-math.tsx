import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

// KaTeX stylesheet + self-hosted fonts (spec §1: no CDN — the CSP forbids it).
// This import is what makes KaTeX heavy, so it lives ONLY in this module, which
// the `<Markdown>` renderer loads lazily and exclusively for math-bearing
// content. Vite emits the CSS (and the woff2 faces it references) into this
// module's async chunk. KaTeX inherits the surrounding text color, so dark/light
// themes need no extra rule (spec §1).
import 'katex/dist/katex.min.css'

/**
 * Sanitisation schema for the math pipeline — extended by the STRICT minimum
 * over `rehype-sanitize`'s `defaultSchema` (spec §1).
 *
 * `remark-math` emits each formula as `<code class="language-math math-inline">`
 * (or `math-display`). The default schema keeps `<code>` and the `language-math`
 * class (its `/^language-./` allowance) but strips `math-inline` / `math-display`
 * — the exact tokens `rehype-katex` scans for. Without them KaTeX would never see
 * the nodes. We whitelist ONLY those two class tokens on `<code>`.
 *
 * Ordering is sanitize-first (see `rehypePlugins` below): untrusted input is
 * scrubbed BEFORE KaTeX runs, so any raw HTML (`<script>`, `onerror`, inline
 * `javascript:` links) is already gone. KaTeX then renders the remaining TeX
 * text with `trust: false` (the default) — `\href` / `\url` / `\includegraphics`
 * are refused and shown as inline error text, never as a live link or resource —
 * so its generated MathML/HTML is trusted output and needs no post-scrub. This
 * keeps the schema tiny: no `style` attribute, no MathML tag surface exposed to
 * user input.
 */
const mathSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', 'math-inline', 'math-display']],
  },
}

/**
 * Heavy Markdown renderer with math. Default export so it can be `React.lazy`-ed
 * into its own chunk. Same GFM feature set as the base `<Markdown>` plus
 * `remark-math` (parse `$…$` / `$$…$$`) and `rehype-katex`. `throwOnError: false`
 * renders a broken formula as discreet inline error text instead of crashing the
 * card (spec §1).
 */
export default function MarkdownMath({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeSanitize, mathSchema],
        [rehypeKatex, { throwOnError: false }],
      ]}
    >
      {source}
    </ReactMarkdown>
  )
}
