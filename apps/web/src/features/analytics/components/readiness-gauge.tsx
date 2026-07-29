import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReadinessBreakdown } from '@engram/shared'
import { useT, usePlural, type PluralCategory, type TFunction } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { readinessPercent, readinessSegments } from '../readiness'
import { ReadinessBar, ReadinessSwatch } from './readiness-bar'

/**
 * ONE readiness figure, rendered whole: a headline percentage, the composition
 * bar, and the counts in words.
 *
 * THE LEGEND IS NOT OPTIONAL AND NOT A TOOLTIP. "78 % ready" is true and
 * misleading on its own — the server publishes `neverReviewed` apart precisely
 * so the screen can say "78 % ready, 40 cards never seen", which is the sentence
 * that changes what someone does next. It is therefore always on screen, in text,
 * reachable without hover and without a pointer.
 *
 * `readiness === null` (a subject holding no card) prints `—`, never `0 %`,
 * never `NaN %`: 0 out of 0 is not a score, and the caller renders the reason
 * above.
 */
export function ReadinessGauge({
  title,
  meta,
  breakdown,
  colorHex,
  deltaPoints,
  emphasis = 'default',
}: {
  title: ReactNode
  /** Right-hand line: a countdown, a date, a scope label. */
  meta?: ReactNode
  breakdown: ReadinessBreakdown
  colorHex: string
  /** Points against today's figure; `null` hides the comparison entirely. */
  deltaPoints?: number | null
  emphasis?: 'default' | 'primary'
}) {
  const t = useT()
  const plural = usePlural()
  const percent = readinessPercent(breakdown.readiness)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 flex-1">{title}</div>
        {meta}
      </div>

      <div className="flex items-center gap-3">
        <span
          className={cn(
            'font-mono font-medium tabular-nums tracking-[-0.01em]',
            emphasis === 'primary' ? 'text-2xl text-text' : 'text-lg text-text',
            percent === null && 'text-text-faint',
          )}
          aria-label={
            percent === null
              ? t('analytics.readiness.unanswerableAria')
              : t('analytics.readiness.percentAria', { value: percent })
          }
        >
          {percent === null ? '—' : `${percent} %`}
        </span>
        <ReadinessBar breakdown={breakdown} colorHex={colorHex} className="flex-1" />
        {deltaPoints !== null && deltaPoints !== undefined && (
          <DeltaChip points={deltaPoints} t={t} />
        )}
      </div>

      <ReadinessLegend breakdown={breakdown} colorHex={colorHex} t={t} plural={plural} />
    </div>
  )
}

/**
 * The composition in words: one entry per segment, ALWAYS all three, even at
 * zero. A legend that hides its empty parts makes "0 never seen" and "we don't
 * count those" look identical, and the second is the bug this feature exists to
 * kill.
 */
export function ReadinessLegend({
  breakdown,
  colorHex,
  t,
  plural,
}: {
  breakdown: ReadinessBreakdown
  colorHex: string
  t: TFunction
  plural: (n: number) => PluralCategory
}) {
  const segments = readinessSegments(breakdown)
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {segments.map((s) => (
        <li
          key={s.kind}
          className={cn(
            'flex items-center gap-1.5 text-xs',
            s.count === 0 ? 'text-text-faint' : 'text-text-muted',
          )}
        >
          <ReadinessSwatch kind={s.kind} colorHex={colorHex} />
          <span className="font-mono tabular-nums">{s.count}</span>
          <span>{t(`analytics.readiness.${s.kind}_${plural(s.count)}`)}</span>
        </li>
      ))}
      <li className="ml-auto font-mono text-2xs tabular-nums text-text-faint">
        {t(`analytics.readiness.cardTotal_${plural(breakdown.cardTotal)}`, {
          count: breakdown.cardTotal,
        })}
      </li>
    </ul>
  )
}

/**
 * The projected figure against today's, in points. Neutral ink and a glyph —
 * never red/green, which are reserved for ratings; the direction reads from the
 * arrow, not from colour.
 */
function DeltaChip({ points, t }: { points: number; t: TFunction }) {
  const rounded = Math.round(points)
  const label = t('analytics.readiness.deltaVsToday', {
    points: rounded > 0 ? `+${rounded}` : rounded === 0 ? '0' : `−${Math.abs(rounded)}`,
  })
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-text-muted" title={label}>
      {rounded > 0 ? (
        <ArrowUp className="size-3" strokeWidth={2} aria-hidden />
      ) : rounded < 0 ? (
        <ArrowDown className="size-3" strokeWidth={2} aria-hidden />
      ) : null}
      <span className="font-mono text-xs tabular-nums">{label}</span>
    </span>
  )
}
