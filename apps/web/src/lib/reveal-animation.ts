import { useSyncExternalStore } from 'react'

/**
 * How the answer appears when a review card is revealed (T-046).
 *
 *  · `unfold` — the historical reveal, with some spine: the card lifts and
 *    settles, its elevation deepens, and the answer rises under the question,
 *    which stays on screen.
 *  · `flip`   — the card turns over. The question is REPLACED by the answer;
 *    losing the side-by-side comparison is a deliberate call (see
 *    `review-card.tsx`), not an oversight.
 *  · `none`   — the answer is simply there. No movement at all.
 *
 * `prefers-reduced-motion` OUTRANKS all three. The preference stored here is
 * only ever the user's *product* choice; the value the session actually plays is
 * resolved in `use-review-session.ts`, where a reduced-motion system forces
 * `none` whatever is stored. An accessibility preference set once, for every
 * application, is not something a per-app toggle gets to override.
 */
export const REVEAL_ANIMATIONS = ['unfold', 'flip', 'none'] as const
export type RevealAnimation = (typeof REVEAL_ANIMATIONS)[number]

/**
 * Same shape as `engram-theme` / `engram-lang` (`lib/theme.tsx`,
 * `lib/i18n/index.tsx`): one `localStorage` key, a default applied when nothing
 * (or nonsense) is stored, and the change taking effect without a reload.
 */
const STORAGE_KEY = 'engram-reveal'

/** The project default — the reveal every existing session already plays. */
export const DEFAULT_REVEAL_ANIMATION: RevealAnimation = 'unfold'

function parse(raw: string | null): RevealAnimation {
  return (REVEAL_ANIMATIONS as readonly string[]).includes(raw ?? '')
    ? (raw as RevealAnimation)
    : DEFAULT_REVEAL_ANIMATION
}

/**
 * Read straight from `localStorage` on every snapshot rather than from a cached
 * module variable. `useSyncExternalStore` only requires the snapshot to be
 * referentially stable, and a string literal from a fixed set always is — so the
 * cache would buy nothing and cost the one bug it always costs: a value written
 * before the module was imported (or by a test) that the store never sees.
 */
export function readRevealAnimation(): RevealAnimation {
  try {
    return parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private-mode Safari and friends: storage exists but throws on access.
    return DEFAULT_REVEAL_ANIMATION
  }
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Persist the choice and re-render every subscriber — no reload, no provider. */
export function setRevealAnimation(next: RevealAnimation): void {
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Nothing to do: the value below still takes effect for this page load.
  }
  for (const listener of [...listeners]) listener()
}

/**
 * The stored preference, reactive.
 *
 * No React context and therefore no provider to mount — deliberate. The two
 * readers (the settings control and the review session) never share a subtree:
 * the session renders through a `createPortal` to `document.body`, outside the
 * app shell. A context would have had to wrap `main.tsx` to reach both, for a
 * single scalar that `useSyncExternalStore` already keeps in step everywhere
 * (the same reasoning as `useAuthStatus` in `lib/auth.tsx`).
 *
 * The server snapshot is the default: nothing is prerendered, and reading
 * `localStorage` outside the browser would throw.
 */
export function useRevealAnimation(): RevealAnimation {
  return useSyncExternalStore(subscribe, readRevealAnimation, () => DEFAULT_REVEAL_ANIMATION)
}
