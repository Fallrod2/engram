import type { LucideIcon } from 'lucide-react'
import { Pencil, SkipForward, Undo2 } from 'lucide-react'
import { FSRS_STATE_LABEL_KEYS, glyphClass } from '@/components/fsrs-state-glyph'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT, type TFunction, type TKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useShortcutName, useTouchSession } from './pointer-labels'
import { REMAINING_KEY_BY_STATE, REMAINING_STATES, type RemainingByState } from './queue-stats'

/**
 * The instrumentation strip: 24px, on every pointer type. Exported because the
 * LOADING skeleton (`review-session.tsx`) mirrors this block pixel for pixel and
 * must not copy the number by hand — that is exactly how the skeleton ended up
 * 25px off the play screen before T-023.
 */
export const CONTEXT_INFO_ROW = 'h-6'

/**
 * The touch-only action row (T-029). 44px is not a taste: `Éditer` and `Passer`
 * were a 12×12px glyph each, measured at 390×844 — a quarter of the 44×44 floor
 * WCAG 2.5.5 asks for, and unlabelled on top of that. On a keyboard the same two
 * actions stay where they were, inside the 24px strip, because there they are
 * pointed at with a cursor and pressed with `E` / `S`.
 */
export const CONTEXT_ACTION_ROW = 'h-11'

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
 * The difficulty of the card on screen, as five segments. Second-plane by
 * intent — it explains why some cards keep coming back (the queue draw is
 * weighted by `card.fsrs.difficulty`, see `queue-order.ts`) without competing
 * with the counters next to it — but second-plane is not the same as illegible,
 * and T-024 was the second.
 *
 * What the measurement said (Chromium, both themes, WCAG 2.x ratios computed
 * from the browser's own sRGB rasterisation of the oklch tokens):
 *
 *   fill  `text-muted`    vs page   7.52:1 dark · 6.53:1 light  — already loud
 *   track `border-strong` vs page   1.71:1 dark · 1.47:1 light  — INVISIBLE
 *   fill vs track                   4.39:1 dark · 4.46:1 light
 *
 * So the lit segments were never the problem. The TRACK was: at 1.7:1 the unlit
 * segments simply are not there, which leaves the gauge with no denominator —
 * four bright pickets and nothing to read them against, so "4 out of 5" and
 * "some marks" look the same. WCAG 1.4.11 wants 3:1 for the visual information
 * that identifies a component's state, and the track carries exactly that.
 *
 * Holding BOTH sides of that bar (track ≥ 3:1 against the page AND fill ≥ 3:1
 * against the track) forces the pair, it is not a taste call: a track at ≥ 3:1
 * needs `text-faint` (5.10:1 dark · 4.76:1 light — `border-strong`, `border`,
 * `surface-3` are all under 1.8:1), and a fill 3:1 above `text-faint` needs
 * `text` (3.26:1 dark · 3.32:1 light). `text-muted` cannot clear it — it sits
 * 1.48:1 over `text-faint`. That is the same `text` / `text-faint` pair `DueDot`
 * landed on for the collapsed rail, for the same reason, so the two marks stay
 * one family. Loudness is then dosed with SIZE, not with tone: 6×8px segments
 * instead of 4×8, a 38px mark instead of 28px.
 *
 * Still neutral by construction: no accent (that means "active row" elsewhere)
 * and never `danger` — a hard card is work to do, not a failure.
 *
 * One consequence, accepted knowingly: a visible track means the two EXTREMES
 * (0/5 on a never-reviewed card, 5/5 on the hardest) now differ by tone alone,
 * where before an invisible track made them look nothing alike. That is the
 * right trade — the extremes are the two readings a user needs least often, and
 * every value between them was unreadable before. The screen reader is not
 * asked to rely on tone: `difficultyUnknown` and `difficultyAria` are different
 * sentences.
 *
 * The exact figure is deliberately NOT printed here. It already has a home one
 * row up: the header's `FsrsStateGlyph` tooltip prints difficulty, stability and
 * due together. This mark is the at-a-glance form of the same number.
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
          // The state is on the node, like `DueDot`'s `data-due-tier`: it IS the
          // encoding, so a test can assert the reading without reverse-
          // engineering which utility class happens to paint the fill today.
          data-segment={i < filled ? 'filled' : 'empty'}
          className={cn(
            'inline-block h-2 w-1.5 shrink-0 rounded-xs',
            i < filled ? 'bg-text' : 'bg-text-faint',
          )}
        />
      ))}
    </div>
  )
}

/**
 * What is still ahead, split by FSRS state — four squares and four numbers.
 *
 * T-036: a screen reader has always been told which is which (the `sr-only`
 * names below), and a sighted reader never was. `5 5 0 5` in four unexplained
 * tints is the single densest thing on the session screen and the only one with
 * no key anywhere on the page — the glyph vocabulary itself is documented in
 * `fsrs-state-glyph.tsx`, which is not somewhere a user can look.
 *
 * So the group carries a LEGEND, on the same `Tooltip` the state glyph elsewhere
 * already uses, listing the four states with their square, their name and their
 * count. One tooltip and not four: the question is "what are these four
 * colours", asked once, and four separate tooltips in a 24px strip would mean
 * four hover targets 6px apart.
 *
 * `tabIndex={0}` is deliberate and is the price of the fix: the tooltip opens on
 * focus as well as hover, so the legend is reachable in a session that is meant
 * to be run without a mouse. It is one extra Tab stop, on a screen whose ratings
 * are keyed `1`-`4` and whose actions are keyed `E`/`S` — Tab was not carrying
 * traffic here.
 */
function RemainingCounters({ remaining, t }: { remaining: RemainingByState; t: TFunction }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="group"
          tabIndex={0}
          aria-label={t('session.remainingAria')}
          className="flex items-center gap-3 rounded-xs font-mono tabular-nums"
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
      </TooltipTrigger>
      <TooltipContent side="top" align="end">
        <span className="mb-1 block text-2xs text-text-faint">{t('session.remainingAria')}</span>
        <span className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
          {REMAINING_STATES.map((state) => (
            <span key={state} className="contents">
              <span
                aria-hidden
                className={cn('inline-block size-2 shrink-0 rounded-xs', glyphClass(state))}
              />
              <span className="text-2xs text-text">{t(FSRS_STATE_LABEL_KEYS[state])}</span>
              <span className="text-right font-mono text-2xs tabular-nums text-text-muted">
                {remaining[REMAINING_KEY_BY_STATE[state]]}
              </span>
            </span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One per-card action, in the two forms the two pointer types need.
 *
 * KEYBOARD (unchanged, to the class): a 17px line of `text-2xs` — icon, label
 * collapsing under 640px, `<Kbd>` chip. It is a footnote next to the ratings,
 * which is the correct weight when `E` and `S` do the job.
 *
 * TOUCH: a labelled 44px control. The three things the tester had to guess are
 * all answered here — the word instead of the letter (`Passer`, not `S`), a
 * target a thumb can hit, and no chip promising a key the device lacks. The
 * label is NEVER hidden on touch: a lone glyph is what made "Passer" read as
 * decoration.
 */
function ActionButton({
  icon: Icon,
  label,
  labelKey,
  shortcut,
  touch,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  /** Accessible name, already composed for the pointer type. */
  label: string
  labelKey: TKey
  shortcut: string
  touch: boolean
  disabled: boolean
  onClick: () => void
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      // Focus is the global double-ring indigo (styles.css :focus-visible).
      className={cn(
        'flex items-center transition-colors disabled:pointer-events-none disabled:opacity-50',
        touch
          ? // `active:` and not `hover:`: a finger has no hover, and a sticky
            // hover state after a tap is the classic mobile artefact.
            'h-11 gap-2 rounded-sm px-3 text-sm text-text-muted active:bg-surface-2'
          : 'gap-1.5 text-text-faint hover:text-text-muted',
      )}
    >
      <Icon aria-hidden className={touch ? 'size-4' : 'size-3'} />
      {/* On a keyboard the label still collapses under 640px — the 24px strip
          has to hold three buttons and four counters at 320px. On touch it is
          on its own row, so it always has the room. */}
      <span className={touch ? undefined : 'hidden sm:inline'}>{t(labelKey)}</span>
      {!touch && <Kbd>{shortcut}</Kbd>}
    </button>
  )
}

/**
 * The strip between the card and the ratings: 24px of session instrumentation
 * that never touches the reading surface. It holds what is still ahead — the
 * four FSRS counters, right-aligned — the per-card actions on the left, and the
 * current card's difficulty in between.
 *
 * T-029 — on touch the actions move OUT of that strip and onto a 44px row of
 * their own, under it. They cannot stay: at 320px the three labelled buttons
 * measure ~196px and the four counters ~120px, which overflows the 296px the
 * column has, and 44px controls next to 11px counters read as one row anyway.
 * The strip itself keeps its 24px on both pointer types, so the only thing that
 * differs between a phone and a laptop is one extra row that is present for the
 * whole session — never appearing or disappearing between ASKING and REVEALED,
 * which is the invariant T-023 bought.
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
  /** An undo is in flight: the button stays in place, greyed out (T-010). */
  undoing: boolean
  onEdit: () => void
  onSkip: () => void
  onUndo: () => void
}) {
  const t = useT()
  const touch = useTouchSession()
  const name = useShortcutName()

  // The three per-card actions, declared once and rendered in whichever row the
  // pointer type puts them in. Order is the same on both: Annuler · Éditer ·
  // Passer — undo looks BACKWARD (the card you just left), while the two others
  // act on the card in front of you.
  //
  // "Annuler" exists only when there is something to take back, rather than
  // standing there permanently dead; once armed it STAYS mounted for the whole
  // undo — `disabled` while the POST is in flight, never removed under the
  // finger (T-010). While an undo is in flight the reducer also refuses
  // OPEN_EDIT and SKIP_CARD, so those two say so instead of eating the tap.
  const actions = (
    <>
      {canUndo && (
        <ActionButton
          icon={Undo2}
          label={name('session.undoAria', t('session.keyUndo'))}
          labelKey="session.undo"
          shortcut={t('session.keyUndo')}
          touch={touch}
          disabled={undoing}
          onClick={onUndo}
        />
      )}
      <ActionButton
        icon={Pencil}
        label={name('session.editAria', t('session.keyEdit'))}
        labelKey="session.edit"
        shortcut={t('session.keyEdit')}
        touch={touch}
        disabled={undoing}
        onClick={onEdit}
      />
      <ActionButton
        icon={SkipForward}
        label={name('session.skipAria', t('session.keySkip'))}
        labelKey="session.skip"
        shortcut={t('session.keySkip')}
        touch={touch}
        disabled={undoing}
        onClick={onSkip}
      />
    </>
  )

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div
        className={cn(
          'flex shrink-0 items-center gap-3 text-2xs',
          CONTEXT_INFO_ROW,
          // On touch the left slot is empty (the actions live on their own row),
          // so the counters would drift left under `justify-between`. They stay
          // pinned to the right edge, exactly where the keyboard layout has them.
          touch ? 'justify-end' : 'justify-between',
        )}
      >
        {/* Left slot: the per-card actions on a keyboard. A flex row, so the
            steps that follow can drop their own buttons next to these. */}
        {!touch && <div className="flex items-center gap-3">{actions}</div>}
        {difficulty !== null && <DifficultyGauge difficulty={difficulty} t={t} />}
        <RemainingCounters remaining={remaining} t={t} />
      </div>
      {/* `-ml-3` cancels the first button's own padding so its glyph lines up
          with the card's left edge one row above — the padding is the tap
          target, not an indent. */}
      {touch && (
        <div className={cn('-ml-3 flex shrink-0 items-center', CONTEXT_ACTION_ROW)}>{actions}</div>
      )}
    </div>
  )
}
