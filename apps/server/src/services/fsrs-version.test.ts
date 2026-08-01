import { describe, expect, it } from 'vitest'
import { FSRS_PARAMS } from './fsrs'

/**
 * LANDING CLAIM ↔ SOURCE — the one guard that lives on the SOURCE side.
 *
 * The public landing prints the scheduler's algorithm version in its hero
 * eyebrow (`landing.hero.eyebrow`, `apps/web/src/lib/i18n/dict.fr.ts` and
 * `dict.en.ts`). Nothing in the web app can see this file, and nothing in this
 * file can see the landing — so the string sat at "FSRS v5" while `FSRS_PARAMS`
 * had long since been generating FSRS-6 defaults, and no test anywhere was in a
 * position to notice. It was corrected to "FSRS-6" on 01/08/2026; this test
 * exists so the NEXT bump is noticed by a machine rather than by a reader.
 *
 * ═══ WHAT IS ACTUALLY CHECKED, AND WHAT IT PROVES ═══
 *
 * The parameter vector's length. FSRS-5 is 19 weights, FSRS-6 is 21, and
 * `generatorParameters()` returns whichever the installed ts-fsrs defaults to —
 * so the count is a faithful, if indirect, name for the algorithm generation the
 * app schedules with. It moves exactly when a ts-fsrs upgrade moves the
 * algorithm, which is the event the landing needs to hear about.
 *
 * It does NOT prove the landing says "FSRS-6" — a string in another workspace,
 * behind an i18n dictionary, is not this file's business and reaching across for
 * it would be a text match pretending to be a proof. What this test does is
 * FAIL, loudly and at the right moment, with instructions: when it goes red,
 * ts-fsrs changed generation under us and `landing.hero.eyebrow` has to be
 * re-read in both dictionaries before the number here is updated.
 *
 * The one way it can be fooled: a future FSRS-7 that also carries 21 weights.
 * Written down rather than papered over.
 */
describe('FSRS algorithm generation (landing claim)', () => {
  it('still schedules with the 21-weight FSRS-6 defaults the landing advertises', () => {
    expect(
      FSRS_PARAMS.w.length,
      'ts-fsrs changed its default parameter vector: re-read `landing.hero.eyebrow` in ' +
        'apps/web/src/lib/i18n/dict.fr.ts and dict.en.ts (it names the algorithm version) ' +
        'before touching this number.',
    ).toBe(21)
  })
})
