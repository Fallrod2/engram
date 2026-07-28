import { useCallback } from 'react'
import { useT, type TKey } from '@/lib/i18n'
import { useCoarsePointer } from '@/lib/use-media-query'

/**
 * T-029 — how the session decides it is being used with a finger.
 *
 * The criterion is the CSS `(pointer: coarse)` media query (`useCoarsePointer`,
 * already the precedent in this feature since the previous batch), never the
 * viewport width. Width answers "how much room is there", which is a layout
 * question; it says nothing about what is touching the screen. The two come
 * apart in both directions and both cases are ordinary:
 *
 *   · an iPad at 1024px wide is a touch device — a width rule would serve it the
 *     `Espace` chip and the 12px icon buttons, i.e. exactly the bug being fixed;
 *   · a 1280×800 laptop window shrunk to 380px, or a small netbook, has a
 *     keyboard and a trackpad — a width rule would strip its hints for nothing.
 *
 * `pointer` describes the PRIMARY pointing device, which is the right question:
 * a laptop with a touchscreen reports `fine` (its trackpad leads) and keeps the
 * keyboard affordances, while a tablet with a keyboard case reports `coarse` and
 * loses only the hints — never the shortcuts themselves. That asymmetry is
 * deliberate and it is what makes the query safe to rely on: **nothing in this
 * feature gates BEHAVIOUR on the pointer type**. The global key router in
 * `use-review-session.ts` does not read it, so Space, 1-4, S, E, U and Escape
 * keep working on every device, whatever the media query says. Only the
 * advertising of those keys moves.
 */
export function useTouchSession(): boolean {
  return useCoarsePointer()
}

/**
 * An accessible name that mentions its keyboard shortcut — on a keyboard only.
 *
 * "Passer cette carte sans la noter (S)" read out on a phone promises a key the
 * device does not have, and it is also the WCAG 2.5.3 trap in reverse: on touch
 * the visible label is `Passer`, so the spoken name should be the same sentence
 * without a key nobody can press. Composing the suffix here keeps ONE sentence
 * per action in the dictionary instead of a touch copy and a keyboard copy that
 * drift apart.
 */
export function useShortcutName(): (label: TKey, key: string) => string {
  const t = useT()
  const touch = useTouchSession()
  return useCallback(
    (label: TKey, key: string) =>
      touch ? t(label) : t('session.withShortcut', { label: t(label), key }),
    [t, touch],
  )
}
