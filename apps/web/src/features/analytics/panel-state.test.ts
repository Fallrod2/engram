import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { panelBody } from './panel-state'

/**
 * The regression this file exists to catch, stated as the thing that actually
 * happened: T-066 replaced `data ? panel : <Skeleton/>` with `data || isError`
 * on seven panels of `/analytics`, and the review then measured that deleting
 * `|| isError` from ANY of them left all 1418 tests green. A future edit could
 * have walked the screen straight back into a permanent skeleton — on a route
 * whose `Promise.allSettled` loader guarantees nothing else would say a word.
 *
 * Every case below is one of those seven gates in one of its three states.
 */

/** A landed read. The value is irrelevant; only "is there one" is. */
const landed = { data: { totals: [] }, isError: false }
const pending = { data: undefined, isError: false }
const failed = { data: undefined, isError: true }

describe('panelBody — a failed read never wears the skeleton', () => {
  it('renders the error, not the skeleton, when the read failed', () => {
    // THE case. Mutating `isError` out of this line is the regression.
    expect(panelBody(failed)).toBe('error')
    expect(panelBody(failed)).not.toBe('skeleton')
  })

  it('keeps the skeleton for the one thing it means: still waiting', () => {
    expect(panelBody(pending)).toBe('skeleton')
  })

  it('renders the payload whenever there is one', () => {
    expect(panelBody(landed)).toBe('data')
  })
})

describe('panelBody — the order between the three', () => {
  it('prefers data to failure, so a failed REFETCH keeps the last good answer', () => {
    // TanStack does not clear `data` when a refetch rejects; blanking a panel
    // that still holds a correct answer would be a worse lie than showing it.
    expect(panelBody({ data: { totals: [] }, isError: true })).toBe('data')
  })

  it('prefers failure to the skeleton, whichever read failed', () => {
    expect(panelBody(pending, true)).toBe('error')
    expect(panelBody(failed, true)).toBe('error')
  })

  it('lets a dependency failure speak for a panel whose own read is fine', () => {
    // The subject list: three panels name their rows through it and DROP what
    // they cannot name, so its loss empties them silently.
    expect(panelBody(pending, true)).toBe('error')
    expect(panelBody(pending, false)).toBe('skeleton')
  })

  it('leaves a landed panel alone even when a dependency failed', () => {
    // The component still has rows and decides for itself what to say about
    // them; the gate's only job is to keep the skeleton off the screen.
    expect(panelBody(landed, true)).toBe('data')
  })
})

describe('panelBody — `undefined` is the only "nothing landed"', () => {
  it('treats a falsy-but-present payload as data', () => {
    // An empty list, a zero, an empty string: all real answers from the server.
    for (const data of [[], 0, '', false]) {
      expect(panelBody({ data, isError: false }), JSON.stringify(data)).toBe('data')
    }
  })
})

/* ────────────────────── the other half of the hole ───────────────────────
 *
 * The cases above prove the RULE. They cannot prove the route still asks for
 * it: `analytics.tsx` reads its own URL search params, so mounting it needs a
 * router, and nothing in this repo mounts one. That gap is exactly what let
 * seven hand-written gates go unprotected, so it is closed from the other side
 * — by the shape of the source rather than by rendering it.
 *
 * THE RULE HERE: on this screen, no query handle decides on its own that a
 * skeleton belongs on screen. A skeleton means "still waiting", and whether a
 * read that FAILED is still waiting is the question `panelBody` answers; a
 * condition that reaches for `xQuery.data` to pick a skeleton has bypassed it.
 *
 * It catches both shapes at once — the `data || isError` gates as they stood,
 * and the one-token mutation of them (`data` alone) that the review measured as
 * invisible. What it does NOT catch is someone rewriting a call as
 * `panelBody(q) === 'data'`; that is a different edit, not a deletion, and the
 * weaker claim is stated rather than implied.
 */

const ROUTE = fileURLToPath(new URL('../../routes/analytics.tsx', import.meta.url))

/** The condition of every ternary in `src` that renders a `*Skeleton`. */
function skeletonGates(src: string): string[] {
  const sf = ts.createSourceFile('scan.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rendersSkeleton = (node: ts.Node): boolean => {
    let found = false
    const walk = (n: ts.Node): void => {
      if (found) return
      const tag =
        ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n) ? n.tagName.getText(sf) : ''
      if (/Skeleton$/.test(tag)) {
        found = true
        return
      }
      ts.forEachChild(n, walk)
    }
    walk(node)
    return found
  }
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isConditionalExpression(node) &&
      (rendersSkeleton(node.whenTrue) || rendersSkeleton(node.whenFalse))
    ) {
      out.push(node.condition.getText(sf))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('/analytics — no panel picks its own skeleton', () => {
  it('routes every skeleton decision through panelBody', () => {
    const gates = skeletonGates(readFileSync(ROUTE, 'utf8'))
    // Not vacuous: the screen really does have this many panels to gate.
    expect(gates.length).toBeGreaterThanOrEqual(7)
    expect(gates.filter((c) => /[A-Za-z]+Query\b/.test(c))).toEqual([])
  })

  it('flags the gates as they shipped, and their one-token mutation', () => {
    // Verbatim, before the extraction — the seven-of-a-kind shape.
    const asShipped = `const x = (
      <div>{heatmapQuery.data || heatmapQuery.isError ? <ChartCard /> : <HeatmapSkeleton />}</div>
    )`
    expect(skeletonGates(asShipped)).toEqual(['heatmapQuery.data || heatmapQuery.isError'])
    // And the mutation the review measured as invisible to the whole suite.
    const mutated = `const x = <div>{heatmapQuery.data ? <ChartCard /> : <HeatmapSkeleton />}</div>`
    expect(skeletonGates(mutated)).toEqual(['heatmapQuery.data'])
  })

  it('leaves a delegated gate alone', () => {
    const delegated = `const x = <div>{heatmapBody !== 'skeleton' ? <ChartCard /> : <HeatmapSkeleton />}</div>`
    expect(skeletonGates(delegated).filter((c) => /[A-Za-z]+Query\b/.test(c))).toEqual([])
  })
})
