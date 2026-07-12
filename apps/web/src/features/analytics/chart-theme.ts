/**
 * Chart color roles → engram tokens (spec §1.2). The ONLY source of graph
 * colors: no hex/rgb/oklch literal ever appears in a chart component — every
 * value is a `var(--color-*)` string.
 *
 * Why this makes theming free: Recharts passes `fill`/`stroke` straight to SVG,
 * and SVG accepts `var(--color-…)`. Our tokens are driven by `:root[data-theme]`
 * (styles.css), so a chart written against `var(--color-success)` re-themes
 * instantly on the dark/light toggle — no JS, no listener, no re-render.
 */

/** Chrome & ink — axes, grid, the surface color that fills inter-mark gaps. */
export const chartInk = {
  text: 'var(--color-text)',
  muted: 'var(--color-text-muted)',
  faint: 'var(--color-text-faint)',
  grid: 'var(--color-border)', // hairline, solid
  axis: 'var(--color-border-strong)', // baseline
  surface: 'var(--color-surface-2)', // card fill = the 2px gap between marks
} as const

/**
 * The four FSRS ratings → the reserved status tokens (design §2). Validated
 * all-pairs (spec §1.8-A). Used for NOTHING but ratings, and never alone —
 * always with the legend + labels + a frozen order.
 */
export const ratingColor = {
  danger: 'var(--color-danger)', // 1 · Encore
  warning: 'var(--color-warning)', // 2 · Difficile
  success: 'var(--color-success)', // 3 · Bien
  info: 'var(--color-info)', // 4 · Facile
} as const

/** The single-series hue (study time) — the accent indigo, the only free hue. */
export const accentSeries = {
  line: 'var(--color-accent)',
  wash: 'var(--color-accent)',
} as const

/** Resolve a stored subject hex to its themeable `var(--color-subject-N)`. */
export { subjectColorValue } from '@/lib/pigments'
