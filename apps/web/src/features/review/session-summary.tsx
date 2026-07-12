import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { RATINGS } from './labels'
import type { SessionSummary as Summary } from './summary'
import { formatDurationClock, formatSeconds } from './interval-format'

/** Distribution segment fill per rating token (literal classes for Tailwind). */
const SEG_FILL: Record<(typeof RATINGS)[number]['token'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
}
const SEG_TEXT: Record<(typeof RATINGS)[number]['token'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
}

/**
 * End-of-session summary (spec §10.1). Cards viewed as the one hero mono number,
 * the 1–4 distribution as a segmented bar + mono counters, total/average time
 * and a success proxy. Streak is gated (no Phase-1 endpoint, §14) → omitted.
 */
export function SessionSummary({
  summary,
  canReviewAgain,
  onExit,
  onReviewAgain,
}: {
  summary: Summary
  canReviewAgain: boolean
  onExit: () => void
  onReviewAgain: () => void
}) {
  const t = useT()
  const { viewed, byGrade, totalMs, avgMs, successRate } = summary

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col items-center gap-7 px-6 text-center">
      <div className="flex flex-col items-center gap-1">
        <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
          {t('session.summary.done')}
        </p>
        <p className="font-mono text-3xl font-medium tabular-nums leading-none tracking-[-0.02em] text-text">
          {viewed}
        </p>
        <p className="text-sm text-text-muted">
          {t(viewed > 1 ? 'session.summary.cardsViewed_other' : 'session.summary.cardsViewed_one')}
        </p>
      </div>

      {/* 1–4 distribution */}
      <div className="w-full">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          {RATINGS.map((r) => {
            const pct = viewed === 0 ? 0 : (byGrade[r.grade] / viewed) * 100
            return (
              <div
                key={r.grade}
                className={cn('h-full', SEG_FILL[r.token])}
                style={{ width: `${pct}%` }}
              />
            )
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
          {RATINGS.map((r) => (
            <span key={r.grade} className="flex items-center gap-1">
              <span className="text-text-muted">{t(r.label)}</span>
              <span className={SEG_TEXT[r.token]}>{byGrade[r.grade]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Time + success */}
      <div className="grid w-full grid-cols-3 gap-2">
        <Stat label={t('session.summary.time')} value={formatDurationClock(totalMs)} />
        <Stat label={t('session.summary.avgPerCard')} value={formatSeconds(avgMs)} />
        <Stat label={t('session.summary.success')} value={`${successRate} %`} />
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button autoFocus onClick={onExit}>
          {t('common.backToDashboard')}
          <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">
            {t('session.keyEnter')}
          </Kbd>
        </Button>
        {canReviewAgain && (
          <Button variant="ghost" onClick={onReviewAgain} className="text-text-muted">
            <RotateCcw className="size-4" />
            {t('session.summary.reviewAgain')}
            <Kbd className="ml-1">R</Kbd>
          </Button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-2.5">
      <span className="font-mono text-sm tabular-nums text-text">{value}</span>
      <span className="text-2xs uppercase tracking-[0.06em] text-text-faint">{label}</span>
    </div>
  )
}
