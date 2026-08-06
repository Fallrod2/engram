import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TOAST_DURATION_MS } from './sonner'

/**
 * ONE toast duration for the whole app (T-036).
 *
 * The report said the undo toast outstayed its welcome. It never had a duration
 * of its own — nor does any of the ~70 other toasts — so all of them rode
 * sonner's internal default, which is not readable from this repo. The fix is
 * that the number now EXISTS here; the guard is that no call site may quietly
 * grow its own.
 *
 * Node environment: this reads source files, it does not mount anything.
 */
function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('toast duration', () => {
  it('is declared, not inherited from the library', () => {
    expect(TOAST_DURATION_MS).toBe(4000)
    expect(readSource('./sonner.tsx')).toContain('duration={TOAST_DURATION_MS}')
  })

  it('no toast in the app sets a duration of its own', () => {
    // A per-toast override is not forbidden for ever — it is forbidden SILENTLY.
    // Whoever needs one changes this test and says why in the same commit.
    const files = import.meta.glob('../../**/*.{ts,tsx}', { eager: true, query: '?raw' }) as Record<
      string,
      { default: string }
    >
    // A glob that matched nothing would pass this test for the wrong reason.
    expect(Object.keys(files).length).toBeGreaterThan(200)
    const offenders = Object.entries(files)
      .filter(([path]) => !path.includes('.test.') && !path.endsWith('ui/sonner.tsx'))
      .filter(([, mod]) => /toast[^\n]*\{[^}]*\bduration\s*:/.test(mod.default))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
