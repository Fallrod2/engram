import { describe, expect, it } from 'vitest'
import { parseQcm } from '@engram/shared'
import { DEMO_QCM_CARDS } from './demo.service'

/**
 * The demo seed writes QCM as plain Markdown (T-022), and nothing at write time
 * checks that shape: a card that misses the format silently degrades to the
 * ordinary front/back rendering. This suite closes that hole by running the REAL
 * render-time parser over the seeded cards.
 *
 * Vitest, not `bun:test`, hence `.test.ts` and not the `.spec.ts` of its
 * neighbour `demo.service.spec.ts`: nothing here touches the database, only the
 * literal `DEMO_QCM_CARDS` and the pure parser.
 */

/**
 * The answer each seeded QCM is MEANT to have, written here independently of the
 * seed. Without it the suite would only prove the cards parse, and would happily
 * rubber-stamp a back whose letter points at the wrong option.
 */
const EXPECTED_ANSWER: Record<string, string> = {
  'Par quelles opérations la classe des langages réguliers est-elle close ?': 'C',
  'Pourquoi une grammaire récursive à gauche bloque-t-elle un analyseur descendant ?': 'B',
  'Which verb collocates with “deadline”?': 'A',
  'Que fait une ε-transition dans un automate fini non déterministe ?': 'B',
}

/** Mirrors `MAX_OPTIONS` in the parser: a 5th option `E` collides with edit. */
const MAX_OPTIONS = 4

describe('the demo seed speaks the QCM format', () => {
  it('seeds multiple-choice cards at all', () => {
    expect(DEMO_QCM_CARDS.length).toBeGreaterThan(0)
  })

  it('seeds one QCM that is due on sight (learning profile)', () => {
    // Profile 1 replays a single Good 6 days ago → learning, 10-minute step →
    // due 6 days in the past. See DEMO_QCM_CARDS.
    expect(DEMO_QCM_CARDS.some((qcm) => qcm.profile === 1)).toBe(true)
  })

  for (const [index, qcm] of DEMO_QCM_CARDS.entries()) {
    describe(`card #${index + 1}`, () => {
      const parsed = parseQcm(qcm.front, qcm.back)

      it('is recognised as a QCM by the render-time parser', () => {
        expect(parsed).not.toBeNull()
      })

      it('carries a question, 2 to 4 options lettered from A, and a justification', () => {
        expect(parsed).not.toBeNull()
        if (parsed === null) return
        expect(parsed.question).not.toBe('')
        expect(parsed.options.length).toBeGreaterThanOrEqual(2)
        expect(parsed.options.length).toBeLessThanOrEqual(MAX_OPTIONS)
        expect(parsed.options.map((o) => o.letter)).toEqual(
          parsed.options.map((_, i) => String.fromCharCode(65 + i)),
        )
        expect(parsed.options.every((o) => o.text.trim() !== '')).toBe(true)
        expect(parsed.explanation).not.toBe('')
      })

      it('points at the answer it was written for', () => {
        expect(parsed).not.toBeNull()
        if (parsed === null) return
        const expected = EXPECTED_ANSWER[parsed.question]
        expect(expected).toBeDefined()
        expect(parsed.options[parsed.answerIndex]?.letter).toBe(expected)
      })
    })
  }
})
