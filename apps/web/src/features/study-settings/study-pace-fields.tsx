import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { STUDY_PACE_MAX, type StudySettingsResponse } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DAILY_GOAL_PRESETS,
  NEW_CARDS_PRESETS,
  parsePaceInput,
  projectedDailyReviews,
} from './pace'
import { studySettingsOptions, useUpdateStudySettings } from './queries'

/**
 * THE study-pace control (T-049). ONE component, mounted in TWO places:
 *
 *   · Settings → « Rythme de révision » (`study-pace-card.tsx`, which only adds
 *     the Card chrome);
 *   · step 2 of the first-run journey.
 *
 * It is a shared component and not two screens on purpose. The pair of numbers
 * has a non-obvious meaning — one is a hard constraint, the other is decoration
 * — and a second implementation would be a second chance to get that wrong. It
 * also means the journey and the settings screen can never drift into telling
 * the user two different things about the same number.
 *
 * ═══ NOTHING IS WRITTEN UNLESS THE USER CHANGES A VALUE ═══
 *
 * The whole journey is skippable, and step 2's « Passer » must leave the account
 * exactly as it found it. So there is no "Save" that fires on mount and no
 * effect that persists what it read: a PATCH happens only on an explicit commit
 * (blur with a changed value, Enter, or a preset click). Same invariant as the
 * theme and the language, one layer up.
 *
 * ═══ WHY IT COMMITS ON BLUR RATHER THAN BEHIND A SAVE BUTTON ═══
 *
 * Every other row of the settings screen applies immediately (theme, language,
 * motion), and a lone "Save" here would make this the one place where a change
 * silently does not count. Blur/Enter/preset is the same contract, and a failed
 * write says so and rolls the field back to the stored value rather than leaving
 * a number on screen that the server never accepted.
 */
export function StudyPaceFields({ className }: { className?: string | undefined }) {
  const t = useT()
  const query = useQuery(studySettingsOptions())

  if (query.isPending) return <PaceSkeleton className={className} />
  if (query.isError) {
    return (
      <p className={cn('text-sm text-text-muted', className)}>{t('settings.pace.unavailable')}</p>
    )
  }
  return <PaceBody data={query.data} className={className} />
}

function PaceSkeleton({ className }: { className?: string | undefined }) {
  const t = useT()
  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      role="status"
      aria-busy="true"
      aria-label={t('settings.pace.title')}
    >
      <Skeleton className="h-8 w-full rounded-sm" />
      <Skeleton className="h-4 w-2/3 rounded-sm" />
      <Skeleton className="h-8 w-full rounded-sm" />
    </div>
  )
}

function PaceBody({
  data,
  className,
}: {
  data: StudySettingsResponse
  className?: string | undefined
}) {
  const t = useT()
  const update = useUpdateStudySettings()
  const { settings, today } = data

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <PaceField
        id="pace-new-cards"
        label={t('settings.pace.newCardsLabel')}
        hint={t('settings.pace.newCardsHint')}
        value={settings.newCardsPerDay}
        min={0}
        presets={[...NEW_CARDS_PRESETS]}
        presetsLabel={t('settings.pace.presetsLabel')}
        disabled={update.isPending}
        onCommit={(newCardsPerDay) => {
          update.mutate(
            { newCardsPerDay },
            { onError: () => toast.error(t('settings.pace.error')) },
          )
        }}
        footer={
          <>
            <p className="text-xs leading-relaxed text-text-muted">
              {settings.newCardsPerDay === 0
                ? t('settings.pace.projectionPaused')
                : t('settings.pace.projection', projectedDailyReviews(settings.newCardsPerDay))}
            </p>
            <p className="font-mono text-2xs tabular-nums text-text-faint">
              {t('settings.pace.todayNew', {
                introduced: today.newCardsIntroduced,
                limit: settings.newCardsPerDay,
              })}
            </p>
          </>
        }
      />

      {/* The one thing a user has to understand about this number, said once and
          in full: it is what keeps a 300-card import from turning into an
          unliveable week. */}
      <p className="rounded-sm border border-border bg-surface-2/60 p-3 text-xs leading-relaxed text-text-muted">
        {t('settings.pace.why')}
      </p>

      <Separator />

      <PaceField
        id="pace-daily-goal"
        label={t('settings.pace.goalLabel')}
        hint={t('settings.pace.goalHint')}
        value={settings.dailyGoal}
        min={1}
        presets={[...DAILY_GOAL_PRESETS]}
        presetsLabel={t('settings.pace.presetsLabel')}
        disabled={update.isPending}
        onCommit={(dailyGoal) => {
          update.mutate({ dailyGoal }, { onError: () => toast.error(t('settings.pace.error')) })
        }}
        footer={
          <p className="font-mono text-2xs tabular-nums text-text-faint">
            {t('settings.pace.todayGoal', {
              done: today.reviewsDone,
              goal: settings.dailyGoal,
            })}
          </p>
        }
      />
    </div>
  )
}

/**
 * One number: a labelled field, its quick picks, and whatever the caller wants
 * said underneath. The local draft exists only between a keystroke and the
 * commit — `useEffect` resyncs it whenever the SERVER value changes, so a failed
 * PATCH (or a value the server clamped) puts the field back where reality is
 * instead of leaving a number nobody stored.
 */
function PaceField({
  id,
  label,
  hint,
  value,
  min,
  presets,
  presetsLabel,
  disabled,
  onCommit,
  footer,
}: {
  id: string
  label: string
  hint: string
  value: number
  min: number
  presets: number[]
  presetsLabel: string
  disabled: boolean
  onCommit: (next: number) => void
  footer: React.ReactNode
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    const next = parsePaceInput(draft, { min })
    if (next === null) {
      setDraft(String(value)) // nothing to commit → show what is actually stored
      return
    }
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={id}>{label}</Label>
          <span className="text-xs text-text-faint">{hint}</span>
        </div>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={STUDY_PACE_MAX}
          step={1}
          disabled={disabled}
          className="w-24 shrink-0 text-right font-mono tabular-nums"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={presetsLabel}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            aria-pressed={p === value}
            onClick={() => {
              setDraft(String(p))
              if (p !== value) onCommit(p)
            }}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-xs tabular-nums transition-colors duration-fast',
              'disabled:cursor-not-allowed disabled:opacity-50',
              p === value
                ? 'border-accent bg-accent/10 text-text'
                : 'border-border text-text-muted hover:border-border-strong hover:text-text',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">{footer}</div>
    </div>
  )
}
