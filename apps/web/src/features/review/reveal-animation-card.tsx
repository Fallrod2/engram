import { useRef, type KeyboardEvent } from 'react'
import { useReducedMotion } from 'motion/react'
import { Info } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useT, type TKey } from '@/lib/i18n'
import {
  REVEAL_ANIMATIONS,
  setRevealAnimation,
  useRevealAnimation,
  type RevealAnimation,
} from '@/lib/reveal-animation'

/** Label + one plain sentence saying what the option DOES, per value. */
const OPTION_KEYS: Record<RevealAnimation, { label: TKey; desc: TKey }> = {
  unfold: { label: 'settings.reveal.unfold', desc: 'settings.reveal.unfoldDesc' },
  flip: { label: 'settings.reveal.flip', desc: 'settings.reveal.flipDesc' },
  none: { label: 'settings.reveal.none', desc: 'settings.reveal.noneDesc' },
}

/**
 * The reveal-animation setting (T-046) — how the answer arrives during a review
 * session.
 *
 * A radiogroup and not a `<Select>` like the theme/language rows above it, for
 * one reason: three values whose NAMES do not say what they do ("Déploiement"?
 * "Retournement"?) need their sentence visible at the moment of choosing, and a
 * select collapses everything but the label. Same roving-tabindex pattern as
 * `analytics/components/window-filter.tsx` (arrows move and select in one step,
 * one tab stop for the whole group), laid out vertically because each row
 * carries two lines.
 *
 * It lives in `features/review/` rather than in the settings route because the
 * thing it configures does: the route only mounts it.
 *
 * The reduced-motion notice is not decoration. Without it, a user whose OS asks
 * for reduced motion picks "Retournement", sees nothing move, and files a bug —
 * the setting looks broken when it is in fact being outranked, on purpose. The
 * control stays enabled: the choice is still theirs and takes effect the day the
 * system preference goes.
 */
export function RevealAnimationCard() {
  const t = useT()
  const value = useRevealAnimation()
  const reduced = !!useReducedMotion()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight')
      next = (index + 1) % REVEAL_ANIMATIONS.length
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
      next = (index - 1 + REVEAL_ANIMATIONS.length) % REVEAL_ANIMATIONS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = REVEAL_ANIMATIONS.length - 1
    if (next === null) return
    e.preventDefault()
    setRevealAnimation(REVEAL_ANIMATIONS[next]!)
    refs.current[next]?.focus()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.reveal.title')}</CardTitle>
        <CardDescription>{t('settings.reveal.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label={t('settings.reveal.title')}
          className="flex flex-col gap-2"
        >
          {REVEAL_ANIMATIONS.map((option, i) => {
            const selected = option === value
            return (
              <button
                key={option}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                // Roving tabindex: the group is ONE tab stop, arrows move inside
                // it. A `tabIndex={0}` on all three would make a three-value
                // choice cost three tabs on the way to the next control.
                tabIndex={selected ? 0 : -1}
                onClick={() => setRevealAnimation(option)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left',
                  'transition-colors duration-fast ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  // Unselected rows are BARE — border only, no fill. A filled
                  // row reads as a raised button, and three of them stacked read
                  // as three buttons rather than one choice with one answer;
                  // measured in light mode, where `surface-3` is a solid grey
                  // slab, it was the difference between a list and a toolbar.
                  // The fill is what marks the selection, and nothing else uses
                  // it.
                  selected
                    ? 'border-accent bg-accent-subtle text-text'
                    : 'border-border text-text hover:border-border-strong hover:bg-surface-3',
                )}
              >
                <span className="text-sm font-medium">{t(OPTION_KEYS[option].label)}</span>
                <span className={cn('text-xs', selected ? 'text-text-muted' : 'text-text-faint')}>
                  {t(OPTION_KEYS[option].desc)}
                </span>
              </button>
            )
          })}
        </div>
        {reduced && (
          <p className="flex items-start gap-2 text-xs text-text-muted">
            <Info aria-hidden className="mt-px size-3.5 shrink-0 text-text-faint" />
            <span>{t('settings.reveal.reducedNotice')}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
