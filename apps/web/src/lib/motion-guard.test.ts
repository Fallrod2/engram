import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 29/07/2026 — the two couplings that make the motion override work, frozen.
 *
 * Motion is cut in TWO places in this app: the `useReducedMotion` hook on the
 * `motion` side, and the `@media (prefers-reduced-motion: reduce)` block in
 * `styles.css` that clamps every duration to `0.01ms`. An override that lifted
 * only one of them would leave half the animations dead — CSS keyframes and
 * Tailwind transitions on one side, or every `motion` component on the other —
 * with nothing on screen to explain why. Neither half is visible from the other,
 * so neither half can be protected by a component test. Hence this file.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

describe('motion override — the JS half', () => {
  it('routes every component through lib/motion, never straight to motion/react', () => {
    // `lib/motion.ts` is the one place allowed to read motion's own hook: it is
    // what folds the override in. A component importing it directly would keep
    // obeying the system preference no matter what the user chose, and would do
    // it silently — the screen would simply not animate.
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith(join('lib', 'motion.ts')))
      .filter((path) => {
        const src = readFileSync(path, 'utf8')
        return /import\s*\{[^}]*\buseReducedMotion\b[^}]*\}\s*from\s*'motion\/react'/.test(src)
      })
      .map((path) => path.slice(SRC.length))

    expect(offenders, 'import { useReducedMotion } from "@/lib/motion" instead').toEqual([])
  })
})

describe('motion override — the CSS half', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')

  /** The `@media (prefers-reduced-motion: reduce) { … }` block, braces matched. */
  function block(): string {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at, 'styles.css doit toujours honorer prefers-reduced-motion').toBeGreaterThan(-1)
    let depth = 0
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1)
    }
    throw new Error('accolades non appariées')
  }

  it('scopes every selector so the override can switch the block off', () => {
    // A media query cannot be disabled from JS. The only way out is for the
    // rules themselves to stop matching, which is what the attribute does.
    const selectors = block()
      .slice(block().indexOf('{') + 1)
      .split('{')[0]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector, 'a selector the override cannot reach').toMatch(
        /^:root:not\(\[data-motion='full'\]\)/,
      )
    }
  })

  it('keeps :root itself in scope — scroll-behavior lives on the scrolling element', () => {
    expect(block()).toContain('scroll-behavior: auto !important')
    expect(block()).toMatch(/:root:not\(\[data-motion='full'\]\),/)
  })
})
