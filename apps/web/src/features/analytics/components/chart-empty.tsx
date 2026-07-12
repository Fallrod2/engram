import { Button } from '@/components/ui/button'

/**
 * Per-panel empty / low-data / error state that fills a chart's plot area
 * (spec §10). Never a full-screen red page, never a spinner — a calm line, an
 * optional hint, and (on error) an inline retry.
 */
export function ChartEmpty({
  title,
  hint,
  variant = 'empty',
  onRetry,
  height = 240,
}: {
  title: string
  hint?: string
  variant?: 'empty' | 'error'
  onRetry?: () => void
  height?: number
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 px-6 text-center"
      style={{ minHeight: height }}
    >
      <p className="text-sm text-text-muted">{title}</p>
      {hint && <p className="font-mono text-2xs text-text-faint">{hint}</p>}
      {variant === 'error' && onRetry && (
        <Button variant="secondary" size="sm" className="mt-1" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  )
}
