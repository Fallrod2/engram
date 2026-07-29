import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * No hardcoded user-facing string in an `aria-label` / `title` / `alt` /
 * `placeholder`, anywhere the web app renders.
 *
 * WHY A SOURCE SCAN. `StreakPill` and `ThemeToggle` shipped French literals for
 * months in exactly those attributes ("Série de 3 jours", "Passer en thème
 * clair"). Nothing caught them, because a hardcoded string renders perfectly —
 * it just renders in the wrong language, and only a screen-reader user or an
 * anglophone ever finds out. A render test proves the components we happen to
 * know about; this proves the NEXT one, which is the actual deliverable. It
 * earned its keep immediately: run wide, it turned up two more (`<DayLoad>`, the
 * calendar cells) plus a keyboard shortcut that selected on a French label and
 * was therefore dead in English.
 *
 * Two rules, both chosen to have no false positives on the current tree:
 *  1. no accented literal — the French smoking gun;
 *  2. no multi-word literal — catches a hardcoded *English* sentence too, while
 *     leaving short code-ish literals alone (`page === 'root'`).
 *
 * Exempt by construction: `t('…')` keys, `className` values (a prop may legally
 * take JSX, and a Tailwind class list is multi-word), and comments.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const WEB_SRC = join(HERE, '..')
/**
 * Directories scanned: every rendered component. Starting from `components/shell`
 * alone would have missed two of the four real cases — `<DayLoad>` and the
 * calendar cells — because their labels were template literals, which the
 * obvious `grep` for a quoted accented string does not match. So the scan is
 * kept wide and the matcher precise, rather than the reverse.
 */
const SCANNED = ['components', 'features', 'routes']
const ATTRS = ['aria-label', 'title', 'alt', 'placeholder']

const ACCENTED = /[àâäéèêëîïôöùûüÿçœæÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇŒÆ]/
/** Two letter-runs separated by a space — i.e. human prose, not an identifier. */
const MULTI_WORD = /\p{L}\p{L}*\s+\p{L}/u

function tsxFilesIn(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFilesIn(full))
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full)
  }
  return out
}

/**
 * The source text of the value given to `attr`, starting at `from`, plus the
 * index just past it. Handles `="…"`, `='…'` and `={ … }` with nested braces,
 * skipping over string/template contents so a brace inside a literal cannot end
 * the expression early.
 */
function readAttributeValue(src: string, from: number): { value: string; end: number } | null {
  let i = from
  while (i < src.length && /\s/.test(src[i] ?? '')) i++
  if (src[i] !== '=') return null
  i++
  while (i < src.length && /\s/.test(src[i] ?? '')) i++
  const opener = src[i]
  if (opener === '"' || opener === "'") {
    const end = src.indexOf(opener, i + 1)
    if (end === -1) return null
    return { value: src.slice(i, end + 1), end: end + 1 }
  }
  if (opener !== '{') return null
  let depth = 0
  let quote: string | null = null
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (quote) {
      if (ch === '\\') j++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { value: src.slice(i, j + 1), end: j + 1 }
    }
  }
  return null
}

/** Drop `t('key'` / `t(`key`` heads so translation KEYS are never flagged. */
function stripTranslationKeys(expr: string): string {
  return expr.replace(/\bt\(\s*(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, 't(')
}

/**
 * Drop every `className=…` value. A prop can legitimately take JSX (the import
 * screen passes a `<span className="flex flex-wrap …">` as its `title`), and a
 * Tailwind class list is multi-word by nature — without this, styling would read
 * as copy.
 */
function stripClassNames(expr: string): string {
  let out = expr
  for (;;) {
    const at = out.indexOf('className')
    if (at === -1) return out
    const read = readAttributeValue(out, at + 'className'.length)
    // Always consume at least the keyword, so a malformed value cannot loop.
    out = out.slice(0, at) + out.slice(read ? read.end : at + 'className'.length)
  }
}

/** Every string/template literal left in an expression, with its raw text. */
function literalsIn(expr: string): string[] {
  return [...expr.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map((m) => m[2] ?? '')
}

/**
 * Blank out comments, preserving newlines so reported line numbers stay true.
 * Without this, a comment that merely QUOTES the old defect (or a commented-out
 * JSX line) would fail the guard. String literals are skipped so a `//` inside a
 * URL survives.
 */
function stripComments(src: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? ''
    const next = src[i + 1] ?? ''
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next
        i++
      } else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n'
        i++
      }
      i++
      continue
    }
    out += ch
  }
  return out
}

/** Every hardcoded attribute label in one source, as `{ attr, line, literal }`. */
function offendersIn(src: string): { attr: string; line: number; literal: string }[] {
  const out: { attr: string; line: number; literal: string }[] = []
  for (const attr of ATTRS) {
    const re = new RegExp(`(?<![\\w-])${attr}(?=\\s*=)`, 'g')
    for (const match of src.matchAll(re)) {
      const at = match.index ?? 0
      const read = readAttributeValue(src, at + attr.length)
      if (!read) continue
      const candidates = read.value.startsWith('{')
        ? literalsIn(stripClassNames(stripTranslationKeys(read.value)))
        : [read.value.slice(1, -1)]
      for (const literal of candidates) {
        if (!ACCENTED.test(literal) && !MULTI_WORD.test(literal)) continue
        out.push({ attr, line: src.slice(0, at).split('\n').length, literal })
      }
    }
  }
  return out
}

function scan(): string[] {
  const offenders: string[] = []
  for (const dir of SCANNED) {
    for (const file of tsxFilesIn(join(WEB_SRC, dir))) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const o of offendersIn(src)) {
        offenders.push(`${relative(WEB_SRC, file)}:${o.line} — ${o.attr}="${o.literal}"`)
      }
    }
  }
  return offenders
}

describe('rendered a11y strings go through i18n', () => {
  it('has no hardcoded label in aria-label / title / alt / placeholder', () => {
    // A failure lists file:line and the offending text. The fix is always the
    // same: add the string to dict.fr.ts AND dict.en.ts, then use `t('…')`.
    expect(scan()).toEqual([])
  })

  it('actually detects a hardcoded label (the guard is not vacuous)', () => {
    // The two defects verbatim, as they were written in the components — one
    // template literal, one plain attribute. If the scan stopped seeing these,
    // the green above would mean nothing.
    const sample = `<span aria-label={\`Série de \${n} jours\`} title="Switch to light theme" />`
    // Order follows the attribute list, not the source position.
    expect(offendersIn(sample).map((o) => o.literal)).toEqual([
      'Série de ${n} jours',
      'Switch to light theme',
    ])
  })

  it('does not flag a translated attribute, whatever the call shape', () => {
    const ok = [
      `<a aria-label={t('header.backToDashboardAria', { title })} />`,
      `<img alt={t('landing.hero.shotAlt')} />`,
      "<input placeholder={page === 'root' ? t('cmd.placeholder') : t('cmd.filterPlaceholder')} />",
      '<span aria-label={t(`sidebar.streak.aria_${plural(n)}`, { count: n })} />',
      '<span aria-label={label} title={undefined} />',
      '<img alt="" />',
    ]
    for (const sample of ok) expect(offendersIn(sample), sample).toEqual([])
  })
})
