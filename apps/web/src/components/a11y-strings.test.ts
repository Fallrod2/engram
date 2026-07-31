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
 * Three rules, all chosen to have no false positives on the current tree:
 *  1. no accented literal — the French smoking gun;
 *  2. no multi-word literal — catches a hardcoded *English* sentence too, while
 *     leaving short code-ish literals alone (`page === 'root'`);
 *  3. no single WORD either — see below.
 *
 * WHY RULE 3, AND WHAT IT COST (T-047). Rules 1 and 2 shared a blind spot one
 * word wide, and something was sitting in it: `aria-label="Fermer"` on the
 * dialog and sheet primitives. Unaccented, single word, so neither rule fired —
 * and it was not some corner of the app, it was the close button of EVERY modal
 * engram opens. The guard stayed green for months while shipping French to
 * every English user who ever opened a dialog.
 *
 * The obvious objection to rule 3 is that a one-word literal is often an
 * identifier rather than copy. That objection is CORRECT, and it was measured
 * rather than argued: applied to every literal the scanner can see, rule 3
 * flagged three things in the whole tree — `'root'` and `'month'`, twice — and
 * all three were comparison operands in already-translated code
 * (`page === 'root' ? t(…) : t(…)`). Three flags, three false positives.
 *
 * So rule 3 is not softened with an exception list; it is scoped to the position
 * where the objection cannot arise. A plain `attr="…"` literal IS the attribute
 * value, and a bare word sitting there is copy or nothing. A literal recovered
 * from inside `{ … }` is only somewhere in an expression, so rule 3 ignores it
 * and rules 1 and 2 keep covering that position as before. Scoped that way, rule
 * 3 flags exactly one thing on the tree it was written against: `Fermer`. No
 * exception list exists, and none is wanted — a guard whose exception list grows
 * is a guard being negotiated with.
 *
 * WHAT THIS GUARD STILL DOES NOT SEE, stated plainly so the green is not read as
 * more than it is:
 *  · values that are not JSX attributes. `dialog.tsx` carried the very same
 *    French as a FUNCTION DEFAULT (`closeLabel = 'Fermer'`), and no attribute
 *    scan reaches that. It was found by reading the file, not by this test.
 *  · a bare word inside `{ … }` — `aria-label={open ? 'Close' : 'Open'}` passes.
 *  · a string that reaches an attribute through a variable or a helper.
 *  · single letters and 1-char literals, by construction of {@link WORD}.
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
/**
 * A bare word, nothing else: letters only, at least two of them. An accessible
 * name that is one plain word is still copy ("Fermer", "Close", "Suivant") and
 * still has to come from the dictionary. Anchored and letters-only on purpose —
 * `root`, `esc` and friends are words too, but they are not attribute VALUES
 * here, and nothing in the tree passes one as an accessible name.
 */
const WORD = /^\p{L}{2,}$/u

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
      // A plain `attr="…"` literal IS the value. A literal fished out of `{ … }`
      // might be anything the expression happens to contain — including the
      // right-hand side of a comparison that PICKS between two translated
      // strings (`page === 'root' ? t(…) : t(…)`). That distinction does not
      // matter for rules 1 and 2, since no comparison operand in this tree is
      // accented or multi-word, but it is the whole ballgame for rule 3: applied
      // to expression literals it flagged `'root'` and `'month'` — three hits,
      // three false positives, zero defects. So rule 3 is scoped to the position
      // where a bare word can only be copy.
      const isPlainString = !read.value.startsWith('{')
      const candidates = isPlainString
        ? [read.value.slice(1, -1)]
        : literalsIn(stripClassNames(stripTranslationKeys(read.value)))
      for (const literal of candidates) {
        const prose = ACCENTED.test(literal) || MULTI_WORD.test(literal)
        if (!prose && !(isPlainString && WORD.test(literal))) continue
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

  it('detects a single unaccented word — the blind spot that shipped (T-047)', () => {
    // Verbatim, as it stood in `sheet.tsx` and (as a function default) in
    // `dialog.tsx`. Both rules that existed before returned false on it: no
    // accent, no space. Every modal in the app announced its close button in
    // French to an English screen reader, and the suite stayed green.
    expect(offendersIn('<button aria-label="Fermer" />').map((o) => o.literal)).toEqual(['Fermer'])
    // The English equivalent is just as wrong when it is hardcoded.
    expect(offendersIn('<button aria-label="Close" />').map((o) => o.literal)).toEqual(['Close'])
  })

  it('keeps rule 3 off expression literals, where a bare word is an operand', () => {
    // The measured false positives, verbatim from the tree. Both pick between
    // two TRANSLATED strings; the bare word is the discriminator, never the
    // label. Flagging these would have made the guard something to be silenced.
    const operands = [
      "<input placeholder={page === 'root' ? t('cmd.placeholder') : t('cmd.filterPlaceholder')} />",
      "<button aria-label={view === 'month' ? t('planning.prevMonth') : t('planning.prevWeek')} />",
    ]
    for (const sample of operands) expect(offendersIn(sample), sample).toEqual([])
    // The price of that scoping, stated as a test so it is a known hole and not
    // a surprise: a hardcoded word inside braces gets through.
    expect(offendersIn("<button aria-label={open ? 'Close' : 'Open'} />")).toEqual([])
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
