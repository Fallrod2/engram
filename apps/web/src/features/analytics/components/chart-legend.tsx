/**
 * Shared legend (spec §1.3) — always present for ≥ 2 series, the dependable
 * identity channel so the reader never color-matches alone. A rect swatch of
 * the token sits beside a label in TEXT ink (the text never wears the series
 * color).
 */
export interface LegendItem {
  colorVar: string
  label: string
}

export function ChartLegend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-xs"
            style={{ background: it.colorVar }}
          />
          <span className="text-xs text-text-muted">{it.label}</span>
        </li>
      ))}
    </ul>
  )
}
