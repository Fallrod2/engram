import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ANSWER_RISE_KEYFRAMES,
  ANSWER_RISE_TIMES,
  DURATION_BASE,
  DURATION_FAST,
  EASE_INOUT,
  EASE_OUT,
  FLIP_DURATION,
  FLIP_HALF_MS,
  FLIP_KEYFRAMES,
  FLIP_TIMES,
  LIFT_KEYFRAMES,
  LIFT_TIMES,
  MOTION_BUDGET_S,
} from './reveal-motion'

/**
 * T-046 — the reveal animations' numbers, checked against the two things they
 * are answerable to: the design tokens they restate, and CLAUDE.md's 250ms
 * budget.
 *
 * WHY PARSE THE STYLESHEET. motion needs seconds and a JS array; Tailwind needs
 * a CSS variable in ms and a `cubic-bezier()`. There is no way to hand motion
 * the token itself short of reading `getComputedStyle` at runtime, which would
 * mean a layout read on every card and a value that silently falls back to
 * nothing in jsdom. So the values are restated in TS — and the restatement is
 * verified here rather than trusted. Drift becomes a failing test, not a UI that
 * is 60ms off the rest of the app.
 */

const CSS = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8')

/** `--name: 120ms;` → 0.12 (seconds). */
function tokenSeconds(name: string): number {
  const match = CSS.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)ms`))
  if (!match) throw new Error(`token --${name} not found in styles.css`)
  return Number(match[1]) / 1000
}

/** `--name: cubic-bezier(a, b, c, d);` → [a, b, c, d]. */
function tokenBezier(name: string): number[] {
  const match = CSS.match(new RegExp(`--${name}:\\s*cubic-bezier\\(([^)]+)\\)`))
  if (!match) throw new Error(`token --${name} not found in styles.css`)
  return match[1]!.split(',').map((n) => Number(n.trim()))
}

describe('reveal motion — the constants restate the design tokens', () => {
  it('reads the same durations as styles.css', () => {
    expect(DURATION_FAST).toBe(tokenSeconds('transition-duration-fast'))
    expect(DURATION_BASE).toBe(tokenSeconds('transition-duration-base'))
  })

  it('reads the same easing curves as styles.css', () => {
    expect(EASE_OUT).toEqual(tokenBezier('ease-out'))
    expect(EASE_INOUT).toEqual(tokenBezier('ease-inout'))
  })
})

describe('reveal motion — CLAUDE.md’s 250ms budget', () => {
  it('keeps every reveal under the cap, the flip included', () => {
    // The flip is the long one: two half-turns. If it ever needs more room, the
    // budget is the thing that has to move first, in CLAUDE.md, out loud.
    expect(FLIP_DURATION).toBe(DURATION_FAST * 2)
    for (const d of [DURATION_FAST, DURATION_BASE, FLIP_DURATION]) {
      expect(d).toBeLessThanOrEqual(MOTION_BUDGET_S)
    }
  })
})

describe('reveal motion — the shapes the animations depend on', () => {
  it('swaps the faces at exactly half the turn', () => {
    // The content swap is a `setTimeout`; the rotation is a motion keyframe.
    // They are only in step because both are derived from FLIP_DURATION — if
    // this drifts, the question is visibly replaced while the card still faces
    // the user.
    expect(FLIP_HALF_MS).toBe((FLIP_DURATION / 2) * 1000)
    expect(FLIP_TIMES[1]).toBe(0.5)
    expect(FLIP_TIMES[2]).toBe(0.5)
  })

  it('hinges the turn edge-on, so the swap is invisible', () => {
    // ±90° is a card zero pixels wide. The jump from +90 to -90 across a
    // zero-length segment is what makes one continuous turn out of two halves
    // without a 3D scene.
    expect(FLIP_KEYFRAMES).toEqual([0, 90, -90, 0])
    expect(FLIP_KEYFRAMES[1]).toBe(-FLIP_KEYFRAMES[2]!)
  })

  it('brings the card’s lift back to where it started', () => {
    // The whole anchored geometry (T-023/T-044) rests on the question sitting at
    // a constant y. A lift that did not return to 0 would move it for good.
    expect(LIFT_KEYFRAMES.at(0)).toBe(0)
    expect(LIFT_KEYFRAMES.at(-1)).toBe(0)
    expect(Math.min(...LIFT_KEYFRAMES)).toBeLessThan(0)
    expect(LIFT_TIMES).toHaveLength(LIFT_KEYFRAMES.length)
  })

  it('overshoots the answer’s rise, then settles on zero', () => {
    // "un rebond court" — up past the mark, then back. Ending anywhere but 0
    // would leave the answer permanently offset from its layout position.
    expect(ANSWER_RISE_KEYFRAMES.at(0)).toBeGreaterThan(0)
    expect(ANSWER_RISE_KEYFRAMES.at(1)).toBeLessThan(0)
    expect(ANSWER_RISE_KEYFRAMES.at(-1)).toBe(0)
    expect(ANSWER_RISE_TIMES).toHaveLength(ANSWER_RISE_KEYFRAMES.length)
  })
})
