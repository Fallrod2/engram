/**
 * Per-card active-time accumulator (spec §8.2). Measures only *active* time —
 * from the recto appearing to the rating — excluding pauses (tab hidden) and
 * long silences (idle). Pure and injectable (`now`) so it's unit-testable
 * without React or a real clock (spec §16.1 items 7–9).
 */

/** Hard cap on a single card's duration — a safety net for a missed idle. */
export const MAX_CARD_MS = 120_000
/** Silence beyond this stops counting (mechanism A, spec §8.3). */
export const IDLE_MS = 120_000

export interface CardTimer {
  /** Freeze the clock (tab hidden — mechanism B, grace 0). */
  pause(): void
  /** Freeze the clock AND drop the trailing silent window (idle — mechanism A). */
  pauseIdle(): void
  /** Resume counting from now (activity or explicit resume). */
  resume(): void
  /** Active ms so far, rounded and clamped to `[0, MAX_CARD_MS]`. */
  read(): number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * Create a timer for the card being shown. `machinePaused` seeds the paused
 * state from the machine's *current* pause (finding #10): a card mounted while
 * the tab is still hidden must start paused, never counting an absent user.
 */
export function createCardTimer(
  machinePaused: boolean,
  now: () => number = () => performance.now(),
): CardTimer {
  let activeMs = 0
  let paused = machinePaused
  // When mounted paused, no segment is open until the first resume.
  let lastResume: number | null = machinePaused ? null : now()

  function freeze(): void {
    if (paused) return
    if (lastResume !== null) activeMs += now() - lastResume
    lastResume = null
    paused = true
  }

  return {
    pause: freeze,
    pauseIdle() {
      freeze()
      // Drop the IDLE_MS silent window that preceded the freeze (spec §8.3.A).
      activeMs = Math.max(0, activeMs - IDLE_MS)
    },
    resume() {
      if (!paused) return
      lastResume = now()
      paused = false
    },
    read() {
      const running = paused || lastResume === null ? 0 : now() - lastResume
      return clamp(Math.round(activeMs + running), 0, MAX_CARD_MS)
    },
  }
}
