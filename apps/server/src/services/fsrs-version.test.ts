import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FSRSVersion } from 'ts-fsrs'

/**
 * LANDING CLAIM ↔ SOURCE — the guard that had to live on the SOURCE side.
 *
 * The public landing prints the scheduler's algorithm generation in its hero
 * eyebrow (`landing.hero.eyebrow`, both dictionaries). Nothing in the web app
 * can see ts-fsrs and nothing in this workspace can see the landing, so the
 * string sat at "FSRS v5" while the app had long been scheduling with FSRS-6,
 * and no test anywhere was in a position to notice. Corrected on 01/08/2026;
 * this file is what makes the NEXT bump a red test rather than a reader's catch.
 *
 * ═══ WHY IT LIVES UNDER apps/server ═══
 *
 * Because `ts-fsrs` is a server dependency: a test file under `apps/web` cannot
 * resolve it (no hoisted copy), and the landing's dictionaries are plain source
 * files any test can read. So the side that CANNOT be imported decides the
 * location, and the dictionaries are read as text. Both halves of the comparison
 * are therefore real: the version comes from the library the scheduler runs on,
 * the claim comes from the file the visitor reads.
 *
 * ═══ WHAT IS COMPARED ═══
 *
 * `FSRSVersion` is ts-fsrs's own self-description — `"v5.4.1 using FSRS-6.0"` at
 * the time of writing. The MAJOR of the `FSRS-x.y` half is the algorithm
 * generation; the `v5.4.1` half is the npm package and is deliberately ignored
 * (they differ, which is precisely how "FSRS v5" got written down in the first
 * place: someone read the package version and published it as the algorithm).
 *
 * Not asserted against a hard-coded `21` weights, which was this test's first
 * shape: `generatorParameters({ w })` silently pads a short vector up to the
 * current length ("auto fill w from 19 to 21"), so the count could not be moved
 * to watch the guard fail, and an assertion nobody can see fail is a decoration.
 */

/** Repo-relative path, resolved from this test file. */
function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/**
 * The landing has two `eyebrow` strings (the hero and the demo window); this
 * picks the one that names FSRS, which is the only one making a claim about the
 * scheduler.
 */
const FSRS_EYEBROW = /eyebrow: '([^']*FSRS[^']*)'/

const DICTS = {
  fr: '../../../web/src/lib/i18n/dict.fr.ts',
  en: '../../../web/src/lib/i18n/dict.en.ts',
} as const

describe('FSRS generation named by the landing', () => {
  /** e.g. `6` out of `"v5.4.1 using FSRS-6.0"`. */
  const major = /FSRS-(\d+)/.exec(FSRSVersion)?.[1]

  it('ts-fsrs still states which FSRS generation it implements', () => {
    // If this ever fails, the parse below is guessing rather than reading, and
    // the rest of the file would pass for the wrong reason.
    expect(
      major,
      `ts-fsrs no longer names a generation in FSRSVersion ("${FSRSVersion}")`,
    ).toBeDefined()
  })

  for (const [lang, path] of Object.entries(DICTS)) {
    it(`the ${lang} hero eyebrow names that same generation`, () => {
      const eyebrow = FSRS_EYEBROW.exec(readSource(path))?.[1]
      expect(eyebrow, `no FSRS eyebrow found in ${path}`).toBeDefined()
      expect(
        eyebrow,
        `The landing advertises a different FSRS generation than the one the scheduler runs ` +
          `(ts-fsrs reports "${FSRSVersion}"). Update \`landing.hero.eyebrow\` in ` +
          `apps/web/src/lib/i18n/dict.fr.ts and dict.en.ts — both, they are shown to different readers.`,
      ).toContain(`FSRS-${major}`)
    })
  }
})
