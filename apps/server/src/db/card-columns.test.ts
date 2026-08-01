import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * T-060, the half that a runtime test cannot hold.
 *
 * `card-columns.spec.ts` proves that `cardColumns` costs less and loses nothing.
 * It cannot prove that the SERVICES use it: a new `db.select().from(card)` added
 * next month would pass every test in the repo while quietly shipping each
 * card's text twice again, because SELECT * is a superset — nothing breaks, it
 * just costs. A cost regression is invisible to assertions about behaviour, so
 * it is caught in the shape of the source instead.
 *
 * THE RULE: outside the search (which needs the folds) and the test files (which
 * assert about them), no application read of `card` is a bare SELECT *. That
 * covers `.select()` and `.returning()` alike — the second is the one that is
 * easy to forget, since `insert(card).returning()` also hands back both folds.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

/**
 * Tests are exempt, and only tests: `.spec.ts` files assert ABOUT the fold
 * columns, and `test-support/` seeds rows whose full shape the specs read back.
 * Nobody pays for either — the rule is about what the server does to serve a
 * request, so the exemption is by location, never by "this one is fine".
 */
const EXEMPT_DIR = 'test-support'

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== EXEMPT_DIR) out.push(...tsFiles(p))
      continue
    }
    if (!name.endsWith('.ts') || /\.(spec|test|pgtest)\.tsx?$/.test(name)) continue
    out.push(p)
  }
  return out
}

/** Is `node` the identifier `card` (the table), as passed to `from`/`insert`? */
const isCardTable = (node: ts.Node): boolean => ts.isIdentifier(node) && node.text === 'card'

/**
 * Every zero-argument `.select()` / `.returning()` in `src` whose chain names the
 * `card` table, reported as `line: text`.
 *
 * A Drizzle chain parses inside-out: `db.select().from(card)` is
 * `(db.select()).from(card)`, so from a `from(card)` call the `select()` is
 * `node.expression.expression`. `insert(card).values(…).returning()` runs the
 * other way, so that one walks DOWN the receiver chain instead.
 */
function bareCardSelects(src: string, file: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

  /** `x.y.z(...)` → the innermost callee chain, for walking down a builder. */
  const receiver = (n: ts.Node): ts.Node | undefined =>
    ts.isCallExpression(n)
      ? n.expression
      : ts.isPropertyAccessExpression(n)
        ? n.expression
        : undefined

  const chainMentionsCard = (start: ts.Node): boolean => {
    let n: ts.Node | undefined = start
    while (n) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const m = n.expression.name.text
        if ((m === 'insert' || m === 'update' || m === 'from') && n.arguments.some(isCardTable)) {
          return true
        }
      }
      n = receiver(n)
    }
    return false
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const bare = node.arguments.length === 0

      // `.select().from(card)` — the select is the receiver of `from`.
      if (method === 'from' && node.arguments.some(isCardTable)) {
        const recv = node.expression.expression
        if (ts.isCallExpression(recv) && ts.isPropertyAccessExpression(recv.expression)) {
          if (recv.expression.name.text === 'select' && recv.arguments.length === 0) {
            out.push(`${at(recv)}: ${recv.getText(sf)}.from(card)`)
          }
        }
      }
      // `.insert(card)…returning()` / `.update(card)…returning()`.
      if (method === 'returning' && bare && chainMentionsCard(node.expression.expression)) {
        out.push(`${at(node)}: ${node.getText(sf)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('card reads — nothing goes back to SELECT *', () => {
  it('has no bare select()/returning() on `card` in application code', () => {
    const offenders: string[] = []
    for (const file of tsFiles(SRC)) {
      for (const hit of bareCardSelects(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${file.slice(SRC.length)}:${hit}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('is not vacuous: it flags each shape it claims to catch', () => {
    expect(bareCardSelects(`const r = await db.select().from(card)`, 'x.ts')).toEqual([
      '1: db.select().from(card)',
    ])
    expect(
      bareCardSelects(
        `const r = await tx.select().from(card).innerJoin(deck, on).where(w)`,
        'x.ts',
      ),
    ).toEqual(['1: tx.select().from(card)'])
    expect(
      bareCardSelects(`const [r] = await db.insert(card).values(v).returning()`, 'x.ts'),
    ).toEqual(['1: db.insert(card).values(v).returning()'])
    expect(
      bareCardSelects(`const [r] = await db.update(card).set(s).where(w).returning()`, 'x.ts'),
    ).toEqual(['1: db.update(card).set(s).where(w).returning()'])
  })

  it('leaves the fixed shapes and other tables alone', () => {
    expect(bareCardSelects(`await db.select(cardColumns).from(card).where(w)`, 'x.ts')).toEqual([])
    expect(bareCardSelects(`await db.select({ n: count() }).from(card)`, 'x.ts')).toEqual([])
    expect(bareCardSelects(`await db.select({ card: cardColumns }).from(card)`, 'x.ts')).toEqual([])
    expect(
      bareCardSelects(`await db.insert(card).values(v).returning({ id: card.id })`, 'x.ts'),
    ).toEqual([])
    // Other tables keep SELECT *; the fold columns are this table's problem.
    expect(bareCardSelects(`await db.select().from(reviewLog).where(w)`, 'x.ts')).toEqual([])
    expect(bareCardSelects(`await db.insert(subject).values(v).returning()`, 'x.ts')).toEqual([])
  })
})
