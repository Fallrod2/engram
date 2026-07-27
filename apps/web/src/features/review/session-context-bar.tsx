import { Pencil, SkipForward, Undo2 } from 'lucide-react'
import { FSRS_STATE_LABEL_KEYS, glyphClass } from '@/components/fsrs-state-glyph'
import { Kbd } from '@/components/ui/kbd'
import { useT, type TFunction } from '@/lib/i18n'
import { useCoarsePointer } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { REMAINING_KEY_BY_STATE, REMAINING_STATES, type RemainingByState } from './queue-stats'

/** Segments of the difficulty gauge — one per two points of the 1-10 scale. */
const DIFFICULTY_SEGMENTS = 5
const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 10

/**
 * How many segments a difficulty lights up: `ceil(d / 2)` on the clamped scale,
 * so 1-2 → one segment and 9-10 → five, each segment worth two points.
 *
 * Returns `0` for a card that has never been reviewed. Same trap as the one
 * `weightFor` documents in `queue-order.ts`: the `difficulty` column defaults to
 * `0` and ts-fsrs only writes a real value on the first review, so `0` is not
 * "the easiest card", it is "no measurement yet" — an empty gauge, and its own
 * accessible label. Non-finite values are read the same way rather than
 * rendered as `NaN`.
 */
function filledSegments(difficulty: number): number {
  if (difficulty === 0 || !Number.isFinite(difficulty)) return 0
  const clamped = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, difficulty))
  return Math.ceil((clamped * DIFFICULTY_SEGMENTS) / MAX_DIFFICULTY)
}

/**
 * The difficulty of the card on screen, as five segments. Discreet on purpose:
 * it explains why some cards keep coming back (the queue draw is weighted by
 * `card.fsrs.difficulty`, see `queue-order.ts`) without competing with the
 * counters next to it — hence no colour of its own, and never `danger`: a hard
 * card is work to do, not a failure.
 *
 * Hidden under 640px like the neighbouring button labels — the bar already
 * holds three buttons and four counters and must stay readable at 320px.
 */
function DifficultyGauge({ difficulty, t }: { difficulty: number; t: TFunction }) {
  const filled = filledSegments(difficulty)
  // The tooltip in `fsrs-state-glyph` prints the raw FSRS float; here one
  // decimal is enough, and `Math.round` (not `toFixed`) keeps a whole value
  // whole ("10", not "10.0").
  const label =
    filled === 0
      ? t('session.difficultyUnknown')
      : t('session.difficultyAria', { value: Math.round(difficulty * 10) / 10 })
  return (
    // `role="img"` and not a bare labelled div: same reason as the `role="group"`
    // on the counters — an `aria-label` alone is not mapped on a generic element.
    <div role="img" aria-label={label} className="hidden items-center gap-0.5 sm:flex">
      {Array.from({ length: DIFFICULTY_SEGMENTS }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            'inline-block h-2 w-1 shrink-0 rounded-xs',
            i < filled ? 'bg-text-muted' : 'bg-border-strong',
          )}
        />
      ))}
    </div>
  )
}

/**
 * The strip between the card and the ratings: 24px of session instrumentation
 * that never touches the reading surface. It holds what is still ahead — the
 * four FSRS counters, right-aligned — the per-card actions on the left, and the
 * current card's difficulty in between.
 */
export function SessionContextBar({
  remaining,
  difficulty,
  canUndo,
  undoing,
  onEdit,
  onSkip,
  onUndo,
}: {
  remaining: RemainingByState
  /** FSRS difficulty of the card on screen; `null` when there is no card. */
  difficulty: number | null
  /** There is a rating left to take back — the button exists only then. */
  canUndo: boolean
  undoing: boolean
  onEdit: () => void
  onSkip: () => void
  onUndo: () => void
}) {
  const t = useT()
  // No keyboard on touch → drop the `S` chip (fix-session §3).
  const coarse = useCoarsePointer()
  return (
    <div className="flex h-6 shrink-0 items-center justify-between text-2xs">
      {/* Left slot: the per-card actions. A flex row, so the steps that follow
          can drop their own buttons next to this one. */}
      <div className="flex items-center gap-3">
        {/* Leftmost, and only when there is something to take back: undo looks
            BACKWARD (the card you just left), while the two others act on the
            card in front of you. Nothing to undo → no button at all, rather than
            a permanently dead control. */}
        {canUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={undoing}
            aria-label={t('session.undoAria')}
            className="flex items-center gap-1.5 text-text-faint transition-colors hover:text-text-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <Undo2 aria-hidden className="size-3" />
            <span className="hidden sm:inline">{t('session.undo')}</span>
            {!coarse && <Kbd>U</Kbd>}
          </button>
        )}
        {/* While an undo is in flight the reducer refuses OPEN_EDIT and
            SKIP_CARD, so the bar says so instead of swallowing the click. */}
        {/* Editing sits between "Annuler" and "Passer": a correction is about
            the card you are on, a skip leaves it. */}
        <button
          type="button"
          onClick={onEdit}
          disabled={undoing}
          aria-label={t('session.editAria')}
          className="flex items-center gap-1.5 text-text-faint transition-colors hover:text-text-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <Pencil aria-hidden className="size-3" />
          <span className="hidden sm:inline">{t('session.edit')}</span>
          {!coarse && <Kbd>E</Kbd>}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={undoing}
          // The label collapses under 640px (the bar must hold at 320px), so the
          // aria-label always carries the full meaning, shortcut included.
          aria-label={t('session.skipAria')}
          // Focus is the global double-ring indigo (styles.css :focus-visible).
          className="flex items-center gap-1.5 text-text-faint transition-colors hover:text-text-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <SkipForward aria-hidden className="size-3" />
          <span className="hidden sm:inline">{t('session.skip')}</span>
          {!coarse && <Kbd>S</Kbd>}
        </button>
      </div>
      {difficulty !== null && <DifficultyGauge difficulty={difficulty} t={t} />}
      <div
        role="group"
        aria-label={t('session.remainingAria')}
        className="flex items-center gap-3 font-mono tabular-nums"
      >
        {REMAINING_STATES.map((state) => {
          const value = remaining[REMAINING_KEY_BY_STATE[state]]
          return (
            <span key={state} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('inline-block size-2 shrink-0 rounded-xs', glyphClass(state))}
              />
              {/* The square carries no text, so the state name is spoken from
                  here: the group reads "Nouvelle 3, Apprentissage 1, …". */}
              <span className="sr-only">{t(FSRS_STATE_LABEL_KEYS[state])}</span>
              <span className={value === 0 ? 'text-text-faint' : 'text-text-muted'}>{value}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
