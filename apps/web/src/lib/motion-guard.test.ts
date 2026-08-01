import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
 *
 * ═══ 31/07/2026 — WHAT THIS FILE LEARNED (T-053, T-054) ═══
 *
 * The JS half checked WHERE `useReducedMotion` is imported from. It never
 * checked that anybody READS it, and `theme-toggle.tsx` spent its whole life in
 * that gap: a `motion.span` with `initial`, `animate` and `transition`, and not
 * one mention of the preference anywhere in the file. It obeyed neither the
 * system setting nor the product override, and it obeyed neither in silence,
 * because there is nothing to see — the icon just spins for someone who asked
 * for less movement. The guard was green throughout. It was green *correctly*:
 * a file that never imports the hook cannot import it from the wrong place.
 *
 * Note what does NOT save this app: `motion` only auto-respects the media query
 * when a `<MotionConfig reducedMotion="user">` wraps the tree, and engram mounts
 * none. Every animation is opt-in to the preference, one component at a time,
 * which is exactly the kind of rule that needs a machine watching it.
 *
 * So there are now three rules, and the second is the new one:
 *
 *   1. NOBODY REACHES AROUND `lib/motion`. Hardened (T-054): the old rule was a
 *      regex over `import { … } from 'motion/react'`, so a namespace import or a
 *      barrel re-export walked straight through it. Both forms are now refused,
 *      by parse rather than by pattern.
 *   2. A FILE THAT ANIMATES HAS THE PREFERENCE IN SCOPE. See the honest limits
 *      below — this is the rule that would have caught the theme toggle.
 *   3. The CSS block still carries the scope its override needs.
 *
 * ═══ WHAT RULE 2 PROVES, AND WHAT IT DOES NOT ═══
 *
 * It proves: no file drives a JS animation while the resolved preference is
 * nowhere in it. That is a real property, it is the property the theme toggle
 * violated, and it is mechanically checkable.
 *
 * It does NOT prove that each animation prop actually consults the boolean. A
 * component could take `reduce` and ignore it, and rule 2 would pass. Proving
 * the stronger thing means deciding whether an arbitrary expression depends on a
 * variable, which is a data-flow analysis this repo has no business growing in a
 * test file — and a half-done version would be worse than none, because it would
 * read like a proof while checking a shape. So the weaker claim is made, and
 * made out loud, rather than dressed up: rule 2 catches FORGETTING, which is the
 * failure that actually happened, twice, and not LYING, which has not.
 *
 * The second way to consult the preference is by prop, not by hook. Four review
 * components take a `reduce: boolean` resolved once in `use-review-session.ts`
 * and drilled down, which is correct and deliberate — re-reading the hook per
 * component would be the same value fetched five times. Rule 2 accepts either.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
/** The one module allowed to touch `motion/react`'s own preference hook. */
const OWNER = join('lib', 'motion.ts')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

function parse(src: string, fileName = 'scan.tsx'): ts.SourceFile {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/* ───────────────────────── rule 1: the import fence ───────────────────────── */

const MOTION = 'motion/react'

/**
 * Ways a file can get at `motion/react`'s `useReducedMotion` without asking
 * `lib/motion` for it. The old regex saw only the first.
 */
function fenceBreaksIn(src: string): string[] {
  const sf = parse(src)
  const out: string[] = []
  const isMotion = (spec: ts.Expression | undefined) =>
    !!spec && ts.isStringLiteral(spec) && spec.text === MOTION

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isMotion(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings
      // `import * as m from 'motion/react'` — hands over the whole module,
      // preference hook included, and `m.useReducedMotion()` reads identically
      // at the call site. Invisible to a rule that scans for braces.
      if (bindings && ts.isNamespaceImport(bindings)) out.push('namespace import')
      else if (bindings && ts.isNamedImports(bindings)) {
        for (const e of bindings.elements) {
          // `propertyName` is the name in the module; `name` is the local alias.
          // Aliasing (`useReducedMotion as x`) must not launder it.
          const imported = (e.propertyName ?? e.name).text
          if (imported === 'useReducedMotion') out.push('named import')
        }
      }
    }
    // `export * from 'motion/react'` / `export { useReducedMotion } from …` —
    // a barrel that re-exports the raw hook makes every importer of the barrel
    // an offender that this file would never look at.
    if (ts.isExportDeclaration(node) && isMotion(node.moduleSpecifier)) out.push('re-export')
    // `await import('motion/react')` and `require('motion/react')`.
    if (
      (ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        isMotion(node.arguments[0])) ||
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        isMotion(node.arguments[0]))
    ) {
      out.push('dynamic import')
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return out
}

/* ────────────────── rule 2: animating implies consulting ────────────────── */

/**
 * Props that make `motion` drive an animation from JS. `style` and `className`
 * are absent on purpose: those are CSS, and the `@media` block in `styles.css`
 * already neutralises them without any component's help.
 */
const ANIMATION_PROPS = new Set([
  'animate',
  'initial',
  'exit',
  'transition',
  'variants',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileInView',
  'whileDrag',
  'layout',
  'layoutId',
  'drag',
])

/** Imperative animation handles — animating without a single JSX prop. */
const ANIMATION_HOOKS = new Set(['useAnimationControls', 'useAnimate'])

/** Does this file drive an animation from JavaScript? */
function animates(sf: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf)
      // `motion.div`, `motion.span`, and the `motion(Component)` wrapper.
      if (/^motion[.(]/.test(tag) || tag === 'motion') {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && ANIMATION_PROPS.has(attr.name.getText(sf))) {
            found = true
            return
          }
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ANIMATION_HOOKS.has(node.expression.text)
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** `reduce`, `reduceMotion`, `reduced`, `reducedMotion` — the resolved boolean. */
const PREFERENCE_NAME = /^reduced?(motion)?$/i

/**
 * Is the resolved preference anywhere in this file — as the hook, as a prop, as
 * a parameter, or read off an object (`api.reduce`)?
 *
 * The one thing deliberately NOT counted is `Array.prototype.reduce`, which
 * shares the name and appears in several animating files (`segments.reduce(…)`
 * in the planning panel). The discriminator is exact: the array method is always
 * CALLED, the preference is only ever READ. So a `reduce` that is the callee of
 * a call expression proves nothing and is skipped.
 */
function consultsPreference(sf: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node)) {
      if (node.text === 'useReducedMotion' || node.text === 'useMotionPreference') found = true
      else if (PREFERENCE_NAME.test(node.text)) {
        const parent = node.parent
        const isCalledMethod =
          parent &&
          ts.isPropertyAccessExpression(parent) &&
          parent.name === node &&
          parent.parent &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression === parent
        if (!isCalledMethod) found = true
      }
      if (found) return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('motion override — rule 1, the import fence', () => {
  it('routes every component through lib/motion, never straight to motion/react', () => {
    // `lib/motion.ts` is the one place allowed to read motion's own hook: it is
    // what folds the override in. A component importing it directly would keep
    // obeying the system preference no matter what the user chose, and would do
    // it silently — the screen would simply not animate.
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith(OWNER))
      .flatMap((path) => {
        const breaks = fenceBreaksIn(readFileSync(path, 'utf8'))
        return breaks.map((how) => `${path.slice(SRC.length)} — ${how}`)
      })

    expect(offenders, 'import { useReducedMotion } from "@/lib/motion" instead').toEqual([])
  })

  it('refuses the shapes the old regex let through (T-054)', () => {
    // None of these existed in the tree; the point is that nothing stopped them
    // from being written, and each one silently un-does the override for every
    // component downstream of it.
    expect(fenceBreaksIn(`import * as m from 'motion/react'`)).toEqual(['namespace import'])
    expect(fenceBreaksIn(`export { useReducedMotion } from 'motion/react'`)).toEqual(['re-export'])
    expect(fenceBreaksIn(`export * from 'motion/react'`)).toEqual(['re-export'])
    expect(fenceBreaksIn(`const m = require('motion/react')`)).toEqual(['dynamic import'])
    expect(fenceBreaksIn(`const m = await import('motion/react')`)).toEqual(['dynamic import'])
    // Aliasing must not launder the named import either.
    expect(fenceBreaksIn(`import { useReducedMotion as sys } from 'motion/react'`)).toEqual([
      'named import',
    ])
    // The original defect shape, still caught.
    expect(fenceBreaksIn(`import { motion, useReducedMotion } from 'motion/react'`)).toEqual([
      'named import',
    ])
  })

  it('leaves the legitimate motion imports alone', () => {
    const ok = [
      `import { motion } from 'motion/react'`,
      `import { AnimatePresence, motion } from 'motion/react'`,
      `import { useReducedMotion } from '@/lib/motion'`,
      `import { motion, useAnimationControls } from 'motion/react'`,
    ]
    for (const sample of ok) expect(fenceBreaksIn(sample), sample).toEqual([])
  })
})

describe('motion override — rule 2, animating implies consulting', () => {
  it('has no file that animates with the preference nowhere in it', () => {
    // The rule that would have caught `theme-toggle.tsx`. A failure means: this
    // file drives a JS animation and never mentions the resolved preference, so
    // nothing in it can be obeying `prefers-reduced-motion`. Fix it by reading
    // `useReducedMotion()` from `@/lib/motion`, or by taking the resolved
    // boolean as a prop the way the review components do.
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith(OWNER) && !/\.test\.tsx?$/.test(path))
      .filter((path) => {
        const sf = parse(readFileSync(path, 'utf8'), path)
        return animates(sf) && !consultsPreference(sf)
      })
      .map((path) => path.slice(SRC.length))

    expect(offenders, 'animates without consulting the motion preference').toEqual([])
  })

  it('detects the theme toggle as it shipped (the rule is not vacuous)', () => {
    // Verbatim, minus the imports. This is the whole defect: three animation
    // props, no preference, and a guard that used to be green on it.
    const asShipped = `
      export function ThemeToggle() {
        const { resolved, toggle } = useTheme()
        return (
          <motion.span
            key={resolved}
            initial={{ opacity: 0, rotate: -30 }}
            animate={{ opacity: 1, rotate: 0 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            {resolved === 'dark' ? <Moon /> : <Sun />}
          </motion.span>
        )
      }`
    const sf = parse(asShipped)
    expect(animates(sf)).toBe(true)
    expect(consultsPreference(sf)).toBe(false)
  })

  it('accepts the preference by hook or by prop', () => {
    const byHook = parse(`
      const reduceMotion = useReducedMotion()
      const x = <motion.div initial={reduceMotion ? false : { opacity: 0 }} />`)
    expect(animates(byHook) && consultsPreference(byHook)).toBe(true)

    // Resolved once in `use-review-session.ts`, drilled into four components.
    const byProp = parse(`
      function ProgressBar({ reduce }: { reduce: boolean }) {
        return <motion.div transition={reduce ? { duration: 0 } : { duration: 0.12 }} />
      }`)
    expect(animates(byProp) && consultsPreference(byProp)).toBe(true)

    // Read off the session api object, as `review-session.tsx` does.
    const offApi = parse(`<motion.div initial={api.reduce ? false : { opacity: 0 }} />`)
    expect(consultsPreference(offApi)).toBe(true)
  })

  it('does not mistake Array.prototype.reduce for the preference', () => {
    // `day-detail-panel.tsx` and friends fold over arrays with `.reduce(…)`.
    // Counting that as "consults the preference" would have made rule 2 pass on
    // any file that happens to use the array method — i.e. quietly vacuous.
    const arrayFold = parse(`
      const maxSeg = segments.reduce((m, s) => Math.max(m, s.count), 0)
      const x = <motion.div animate={{ opacity: 1 }} />`)
    expect(animates(arrayFold)).toBe(true)
    expect(consultsPreference(arrayFold)).toBe(false)
  })

  it('does not flag CSS-only motion, which the @media block already covers', () => {
    // A `motion` element with no animation prop, and Tailwind/Radix state
    // classes. Neither is driven from JS, so neither needs the boolean.
    const cssOnly = parse(`
      const a = <motion.div className="transition-colors duration-fast" />
      const b = <div className="data-[state=open]:animate-in" />`)
    expect(animates(cssOnly)).toBe(false)
  })

  it('sees an imperative animation with no JSX prop at all', () => {
    const imperative = parse(`const controls = useAnimationControls()`)
    expect(animates(imperative)).toBe(true)
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
