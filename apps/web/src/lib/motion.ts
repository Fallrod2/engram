import { useSyncExternalStore } from 'react'
import { useReducedMotion as useSystemReducedMotion } from 'motion/react'

/**
 * Motion preference — whether the app plays its animations (29/07/2026).
 *
 * THE SYSTEM PREFERENCE IS THE DEFAULT, AND IT IS OVERRIDABLE.
 *
 * `prefers-reduced-motion: reduce` remains what the app obeys when nobody has
 * said otherwise: no stored value, no attribute on `<html>`, and everything —
 * the `motion` animations and the CSS ones — behaves exactly as it did before
 * this module existed. What changes is that the user can now say otherwise, from
 * inside the app, deliberately, on a control that names what it does. Ignoring
 * the system preference *in silence* is still off the table; letting the person
 * in front of the screen contradict it *out loud* is the whole point (Alex,
 * 29/07/2026).
 *
 *  · `system` (default) — follow `prefers-reduced-motion`.
 *  · `full`             — animate regardless of what the OS asks for.
 *
 * There is deliberately no third `reduce` value. Nobody asked for a way to
 * reduce motion from inside the app: the OS already owns that switch, and a
 * product setting that duplicates it would have to answer "which one wins?" on
 * every screen. This one only ever answers a question the OS cannot: "yes, I
 * know, animate anyway".
 *
 * ═══ THE TWO MECHANISMS ═══
 *
 * Motion is cut in TWO places in this app, and an override that only lifted one
 * of them would leave half the animations dead with no way to tell why:
 *
 *   1. JS — `useReducedMotion()` from `motion/react`, read by every component
 *      that animates through `motion`. That is what {@link useReducedMotion}
 *      below wraps: it is the SAME hook, with the override folded in, and it is
 *      exported under the same name so call sites read identically.
 *   2. CSS — the `@media (prefers-reduced-motion: reduce)` block in `styles.css`
 *      clamps every `animation-duration` / `transition-duration` to `0.01ms`.
 *      A media query cannot be overridden from JS, so the block's selectors are
 *      scoped to `:root:not([data-motion='full'])` and {@link syncDocument}
 *      stamps that attribute on `<html>`. No attribute ⇒ the block applies, i.e.
 *      the system preference wins by default even before any script has run.
 *
 * `motion-guard.test.ts` pins both halves: that no component reaches around this
 * module to `motion/react`, and that the CSS block still carries its scope.
 */
export type MotionPreference = 'system' | 'full'

/** `engram-theme` / `engram-lang` / `engram-motion` — one convention. */
const STORAGE_KEY = 'engram-motion'

/** The attribute the CSS block keys off, on `<html>`. Present only for `full`. */
export const MOTION_ATTRIBUTE = 'data-motion'

export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'system'

function parse(raw: string | null): MotionPreference {
  return raw === 'full' ? 'full' : DEFAULT_MOTION_PREFERENCE
}

/**
 * Read straight from `localStorage` on every snapshot rather than from a cached
 * module variable. `useSyncExternalStore` only needs the snapshot to be
 * referentially stable, and a string literal from a fixed set always is — so a
 * cache would buy nothing and cost the one bug it always costs: a value written
 * before this module was imported (or by a test) that the store never sees.
 */
export function readMotionPreference(): MotionPreference {
  try {
    return parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private-mode Safari and friends: storage exists but throws on access.
    return DEFAULT_MOTION_PREFERENCE
  }
}

/**
 * Reflect the preference onto `<html>`, which is how the CSS half of the
 * override is delivered. Absent attribute = "nothing overridden", the state the
 * page is in before any of this code runs.
 */
function syncDocument(preference: MotionPreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (preference === 'full') root.setAttribute(MOTION_ATTRIBUTE, 'full')
  else root.removeAttribute(MOTION_ATTRIBUTE)
}

/**
 * Apply the stored preference to the document. Called once from `main.tsx`,
 * before the first render — the attribute has to be on `<html>` for the CSS
 * block to be scoped out, and no component owns that.
 */
export function initMotionPreference(): void {
  syncDocument(readMotionPreference())
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Persist the choice, restamp `<html>`, re-render every subscriber. */
export function setMotionPreference(next: MotionPreference): void {
  try {
    // An explicit "follow the system" is STORED, not erased: it is a choice too,
    // and the two are indistinguishable here only because they agree. (Theme and
    // language have to tell them apart — see `lib/theme.tsx` — because there the
    // default and the stored value can disagree.)
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Nothing to do: the value still takes effect for this page load.
  }
  syncDocument(next)
  for (const listener of [...listeners]) listener()
}

/**
 * The stored preference, reactive. No context and therefore no provider to
 * mount — a single scalar that `useSyncExternalStore` keeps in step everywhere,
 * including inside the review session, which renders through a `createPortal`
 * to `document.body` and would otherwise sit outside any provider subtree.
 */
export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(subscribe, readMotionPreference, () => DEFAULT_MOTION_PREFERENCE)
}

/**
 * Does the OS ask for reduced motion? The raw system signal, with no override
 * applied — the settings screen needs it to stay honest ("your system asks for
 * less movement"), and nothing else should.
 */
export function useSystemPrefersReducedMotion(): boolean {
  return !!useSystemReducedMotion()
}

/**
 * THE hook every animated component reads: `prefers-reduced-motion`, unless the
 * user has overridden it.
 *
 * Deliberately named after the `motion/react` hook it replaces, so a call site
 * reads the same and an import swap is the whole migration. Deliberately
 * returning a plain `boolean` and not `boolean | null`: motion's own hook
 * returns `null` before it has read the media query, which every call site in
 * this app was already coercing.
 */
export function useReducedMotion(): boolean {
  const system = useSystemPrefersReducedMotion()
  const preference = useMotionPreference()
  return preference === 'full' ? false : system
}
