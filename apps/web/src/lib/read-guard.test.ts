import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * T-042 — "a failed read renders as empty" has now been the same defect three
 * times, and the third one was found INSIDE the file that had just fixed the
 * second.
 *
 *   T-027 (a) — `dueCounts?.total ?? 0` on the dashboard: a dropped request
 *     became zero cards due, and zero cards due became "Tout est à jour." The
 *     home screen congratulated the user for an outage.
 *   T-027 (b) — the same sentence in `today-panel.tsx`, guarded there.
 *   T-042    — `useQuery(studyTodayOptions()).data` in that very file, two
 *     lines below the guard, hiding the backlog line and the exam banner.
 *
 * The review's verdict on the state of things was "nobody knows which of these
 * are safe without reading every one of them". This file is the answer to that
 * sentence, not to any one occurrence.
 *
 * ═══ THE RULE, AND WHY IT IS THIS ONE ═══
 *
 * The tempting rule is "no `?? 0` on query data". It cannot be written: there
 * are ~120 nullish fallbacks under `apps/web/src`, most of them on `Map.get`,
 * on optimistic-update cache writers, or on function parameters typed
 * `T | undefined`, and a rule that fires on all of those is a rule nobody runs.
 *
 * The rule that IS mechanical: **a `useQuery` result must have its status
 * observable.** Two shapes fail it.
 *
 *   1. THE HANDLE IS DISCARDED. `useQuery(opts()).data` keeps the value and
 *      throws away the only thing that could distinguish "empty", "not yet" and
 *      "failed". This is not a missing branch — it is a branch that CANNOT be
 *      written without editing the line. Every T-027/T-042 occurrence had this
 *      exact shape.
 *   2. THE HANDLE IS BOUND AND NEVER ASKED. `const q = useQuery(...)` where no
 *      `q.isError` / `q.isPending` / `q.status` / … appears anywhere in the
 *      file. Same defect wearing a variable name.
 *
 * ═══ WHAT IT PROVES, AND WHAT IT DOES NOT ═══
 *
 * It proves that every query in the tree is either observed somewhere in its
 * file, covered by a route loader (below), or listed here with a reason. It
 * does NOT prove the observation is correct: a file can read `q.isPending`,
 * render a skeleton, and still let `q.data ?? 0` speak on failure. Proving that
 * means deciding whether a rendered claim depends on a status flag — a data
 * flow analysis that would read like a proof while checking a shape. So the
 * weaker claim is made out loud, exactly as `motion-guard.test.ts` does for its
 * own rule 2: this catches FORGETTING TO LOOK, which is what happened three
 * times, not LOOKING AND LYING, which has not.
 *
 * ═══ THE ROUTE-LOADER EXEMPTION ═══
 *
 * A query listed in a route `loader` via `ensureQueryData`, in a file that also
 * declares an `errorComponent`, genuinely cannot render a failed read: the
 * loader rejects, the router swaps in the error screen, and the component never
 * mounts. A LATER failure keeps the last good value in the cache (TanStack
 * Query does not clear `data` on a failed refetch), so `?? []` still never
 * fires. That exemption is computed here, per file, rather than trusted.
 *
 * Its three deliberate edges, all of them chosen to fail SAFE:
 *   · `Promise.allSettled` loaders are NOT coverage. `/`, `/planning` and
 *     `/analytics` load tolerantly on purpose — failures never reach the error
 *     component, which is precisely why those screens guard by hand.
 *   · `prefetchQuery` is NOT coverage. It swallows its own rejection by design.
 *   · matching is by options-factory NAME, not by argument. So a loader
 *     ensuring `heatmapOptions(year)` also clears `heatmapOptions(currentYear)`
 *     in the page, which is a different cache entry. The honest alternative —
 *     comparing argument text — is loose in the other direction, since
 *     `subjectDetailOptions(params.subjectId)` and `subjectDetailOptions(
 *     subjectId)` ARE the same query written twice. Name matching is the looser
 *     of the two, and this comment is where that is written down.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

/**
 * Members that make a query's outcome observable. `refetch` is deliberately
 * absent: calling it proves an escape hatch exists, not that anyone branched on
 * the failure.
 */
const STATUS_MEMBERS = new Set([
  'isPending',
  'isLoading',
  'isError',
  'isSuccess',
  'isLoadingError',
  'isRefetchError',
  'status',
  'error',
  'fetchStatus',
  'isFetching',
  'isRefetching',
])

/**
 * Reads whose status is not observed in their own file, each with the reason it
 * is nonetheless allowed to stand. Keyed `<path from src/>::<options factory>`.
 *
 * WHAT AN ENTRY MEANS: someone worked out what this screen renders when this
 * read fails, and wrote it down. Adding one is not a formality — an entry that
 * cannot state what the failure looks like is a defect that has not been fixed
 * yet, and should be a `TODO.md` line instead.
 */
const ALLOWED = new Map<string, string>([
  // ── Permission gates. `me` undefined hides the privileged affordance, so a
  // failed read fails CLOSED — the safe direction, and the same one a pending
  // read already takes so the entry never flashes in.
  ['components/shell/sidebar.tsx::meQuery', 'admin entry hidden until /api/me answers'],
  ['routes/admin.tsx::meQuery', 'route guard; the admin screen is gated elsewhere too'],
  ['features/admin/components/users-tab.tsx::meQuery', 'row actions hidden without permissions'],
  ['features/admin/components/groups-tab.tsx::meQuery', 'group actions hidden without permissions'],
  [
    'features/admin/components/create-user-dialog.tsx::meQuery',
    'group picker hidden, submit still valid',
  ],
  [
    'features/onboarding/ai-step.tsx::meQuery',
    'the demo notice is additive; absent = the normal form',
  ],

  // ── Pickers inside a form the user opened deliberately. An empty option list
  // is visibly a broken picker, in a dialog they can close and reopen; it makes
  // no claim about the account the way a list screen's "0" does.
  [
    'features/planning/exam-form-dialog.tsx::subjectsListOptions',
    'subject picker in the exam dialog',
  ],
  ['features/admin/components/create-user-dialog.tsx::adminGroupsOptions', 'optional group picker'],
  ['routes/search.tsx::subjectsListOptions', 'subject filter dropdown'],
  ['routes/search.tsx::allDecksOptions', 'deck filter dropdown'],
  [
    'routes/import.photo.tsx::subjectsListOptions',
    'loader ensures it; no errorComponent, so a first-load failure lands on the router default screen',
  ],

  // ── Offers, not statements. These reads decide whether an EXTRA affordance
  // appears. Without them there is simply nothing to offer; nothing on screen
  // asserts the absence.
  [
    'components/shell/command-menu.tsx::dueCountsOptions',
    'the palette Réviser group is an offer built from a count',
  ],
  [
    'routes/import.$noteId.index.tsx::aiSettingsOptions',
    'deliberate: prefetched, never ensured, so the AI config can never take the note screen down (see the loader comment)',
  ],
  [
    'features/review/session-header.tsx::subjectDetailOptions',
    'scope label falls back to the generic "Matière"',
  ],
  [
    'features/review/session-header.tsx::deckDetailOptions',
    'scope label falls back to the generic "Deck"',
  ],
  [
    'features/review/use-review-session.ts::previewOptions',
    'the next-interval hint; the session runs without it',
  ],
  [
    'features/ai/ai-settings-card.tsx::aiSettingsOptions',
    'the card renders its own error and retry inline',
  ],
  [
    'features/ai/ai-settings-card.tsx::inline',
    'connectivity poll; its result IS the status being displayed',
  ],
  [
    'components/shell/command-cards.tsx::cardSearchOptions',
    '`settled` already requires a fresh successful echo before any hit is shown',
  ],
  [
    'routes/search.tsx::cardDetailOptions',
    'by-id fallback for a ⌘K hand-off; the row is usually already in `known`',
  ],

  // ── ADJACENT MOTIF, not this lot: a failed read rendered as a PERMANENT
  // SKELETON. It asserts "still loading" rather than "empty", so it is not the
  // pattern T-042 was opened for — but it is the same family and these are the
  // known sites. They are listed here rather than left invisible.
  [
    'components/shell/sidebar.tsx::dueCountsOptions',
    'ADJACENT: due counts shimmer for ever instead of failing',
  ],
  [
    'routes/search.tsx::cardCorpusSizeOptions',
    'ADJACENT: no corpus size ⇒ no empty state ⇒ permanent results skeleton',
  ],
  ['routes/analytics.tsx::streaksOptions', 'ADJACENT: permanent StatTiles skeleton'],
  ['routes/analytics.tsx::subjectsListOptions', 'ADJACENT: the subject filter empties'],
  ['routes/analytics.tsx::heatmapOptions', 'ADJACENT: the streak sparkline flattens to []'],
  [
    'routes/analytics.tsx::deltasOptions',
    'ADJACENT: the window-over-window deltas are simply not drawn',
  ],
  ['routes/planning.tsx::subjectsListOptions', 'ADJACENT: calendar chips lose their subject names'],
])

/* ─────────────────────────────── the scan ─────────────────────────────── */

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

function parse(src: string, fileName = 'scan.tsx'): ts.SourceFile {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/**
 * Name of the query-options factory behind a call argument, used both as the
 * report label and as the key the loader exemption matches on. `useQuery(x())`,
 * `useQuery({ ...x(), enabled })` and `useQuery(x)` all resolve to `x`; an
 * object literal with no spread has no factory and is reported as `inline`.
 */
function factoryOf(arg: ts.Expression | undefined): string {
  if (!arg) return 'inline'
  if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) return arg.expression.text
  if (ts.isIdentifier(arg)) return arg.text
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (!ts.isSpreadAssignment(prop)) continue
      const spread = prop.expression
      if (ts.isCallExpression(spread) && ts.isIdentifier(spread.expression))
        return spread.expression.text
      if (ts.isIdentifier(spread)) return spread.text
    }
  }
  return 'inline'
}

/** Does any `<name>.<status>` appear in the file? */
function statusReadOn(sf: ts.SourceFile, name: string): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      STATUS_MEMBERS.has(node.name.text)
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function declaresErrorComponent(sf: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name.getText(sf) === 'errorComponent'
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Is this node lexically inside a `Promise.allSettled(...)` call? */
function insideAllSettled(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (
      ts.isCallExpression(p) &&
      ts.isPropertyAccessExpression(p.expression) &&
      p.expression.name.text === 'allSettled'
    )
      return true
  }
  return false
}

/** Factories the file hands to `ensureQueryData` in a way that can REJECT. */
function ensuredFactories(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'ensureQueryData' &&
      !insideAllSettled(node)
    ) {
      out.add(factoryOf(node.arguments[0]))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

export interface UnobservedRead {
  factory: string
  /** `discarded` = `useQuery(...).data`; `unread` = bound, never asked. */
  how: 'discarded' | 'unread'
  line: number
}

/** Every `useQuery` in this file whose outcome the file cannot see. */
function unobservedReads(sf: ts.SourceFile): UnobservedRead[] {
  const covered = declaresErrorComponent(sf) ? ensuredFactories(sf) : new Set<string>()
  const out: UnobservedRead[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useQuery'
    ) {
      const factory = factoryOf(node.arguments[0])
      if (!covered.has(factory)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        const parent = node.parent
        if (ts.isPropertyAccessExpression(parent)) {
          // `useQuery(...).isError` is an odd but honest observation; only a
          // value read off a thrown-away handle is the defect.
          if (!STATUS_MEMBERS.has(parent.name.text)) out.push({ factory, how: 'discarded', line })
        } else if (ts.isVariableDeclaration(parent)) {
          if (ts.isIdentifier(parent.name)) {
            if (!statusReadOn(sf, parent.name.text)) out.push({ factory, how: 'unread', line })
          } else if (ts.isObjectBindingPattern(parent.name)) {
            const bound = parent.name.elements.map((e) => (e.propertyName ?? e.name).getText(sf))
            if (!bound.some((n) => STATUS_MEMBERS.has(n)))
              out.push({ factory, how: 'unread', line })
          }
        }
        // Anything else — returned from a custom hook, passed as an argument —
        // hands the whole handle on, so the caller can still observe it.
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return out
}

/* ──────────────────────────────── the rule ─────────────────────────────── */

describe('failed reads — every query is observed, covered, or listed', () => {
  it('has no unobserved query outside the allowlist', () => {
    const offenders: string[] = []
    for (const path of sourceFiles(SRC)) {
      const rel = path.slice(SRC.length).split(sep).join('/')
      const sf = parse(readFileSync(path, 'utf8'), path)
      for (const read of unobservedReads(sf)) {
        const key = `${rel}::${read.factory}`
        if (!ALLOWED.has(key)) offenders.push(`${key} (line ${read.line}, ${read.how})`)
      }
    }
    expect(
      offenders,
      'keep the useQuery handle and branch on isPending/isError, or add an ALLOWED entry saying what a failed read renders',
    ).toEqual([])
  })

  it('keeps the allowlist honest — no entry for a read that no longer exists', () => {
    // A stale entry is worse than none: it reads as a considered decision about
    // a line that has since been fixed or deleted, and it quietly widens the
    // hole for whatever is written at that path next.
    const live = new Set<string>()
    for (const path of sourceFiles(SRC)) {
      const rel = path.slice(SRC.length).split(sep).join('/')
      const sf = parse(readFileSync(path, 'utf8'), path)
      for (const read of unobservedReads(sf)) live.add(`${rel}::${read.factory}`)
    }
    expect([...ALLOWED.keys()].filter((k) => !live.has(k))).toEqual([])
  })
})

/* ─────────────── the rule is not vacuous: the real defects ─────────────── */

describe('failed reads — the guard on the shapes that actually shipped', () => {
  it('catches `useQuery(...).data`, the T-042 line, verbatim', () => {
    // `today-panel.tsx` as it shipped. The file DID branch on `isPending` and
    // `isError` — for the other query. This one had no handle to branch on.
    const asShipped = `
      export function TodayPanel() {
        const countsQuery = useQuery(dueCountsOptions())
        const today = useQuery(studyTodayOptions()).data
        const overdue = today?.overdueCount ?? 0
        if (countsQuery.isPending) return <Skeleton />
        if (countsQuery.isError) return <Unknown />
        return <p>{overdue}</p>
      }`
    expect(unobservedReads(parse(asShipped))).toEqual([
      { factory: 'studyTodayOptions', how: 'discarded', line: 4 },
    ])
  })

  it('catches the T-027 dashboard line', () => {
    const asShipped = `const total = useQuery(dueCountsOptions()).data?.total ?? 0`
    expect(unobservedReads(parse(asShipped))).toEqual([
      { factory: 'dueCountsOptions', how: 'discarded', line: 1 },
    ])
  })

  it('catches a bound handle nobody ever asks — the same defect, named', () => {
    const named = `
      const streakQuery = useQuery(streaksOptions(now))
      const current = streakQuery.data?.current ?? 0`
    expect(unobservedReads(parse(named))).toEqual([
      { factory: 'streaksOptions', how: 'unread', line: 2 },
    ])
  })

  it('catches `const { data } = useQuery(...)` with no status destructured', () => {
    const destructured = `const { data } = useQuery(dueCountsOptions())`
    expect(unobservedReads(parse(destructured))).toEqual([
      { factory: 'dueCountsOptions', how: 'unread', line: 1 },
    ])
  })

  it('is not fooled by an options object literal spreading the factory', () => {
    const spread = `const q = useQuery({ ...cardSearchOptions(apiQuery), enabled })
      const hits = q.data?.hits ?? []`
    expect(unobservedReads(parse(spread))).toEqual([
      { factory: 'cardSearchOptions', how: 'unread', line: 1 },
    ])
  })
})

describe('failed reads — what the guard deliberately accepts', () => {
  it('accepts a handle whose status is read anywhere in the file', () => {
    const guarded = `
      const countsQuery = useQuery(dueCountsOptions())
      if (countsQuery.isPending) return <Skeleton />
      if (countsQuery.isError) return <Unknown />
      return <p>{countsQuery.data.total}</p>`
    expect(unobservedReads(parse(guarded))).toEqual([])
  })

  it('accepts a destructured status', () => {
    const guarded = `const { data, isPending, isError } = useQuery(healthOptions())`
    expect(unobservedReads(parse(guarded))).toEqual([])
  })

  it('accepts a handle handed straight on to a caller', () => {
    // `features/ai/queries.ts` returns the whole result from a custom hook; the
    // component that calls it is where the status can be observed.
    const passed = `export function useThing() { return useQuery(thingOptions()) }`
    expect(unobservedReads(parse(passed))).toEqual([])
  })

  it('accepts a read the route loader ensures behind an errorComponent', () => {
    const covered = `
      export const Route = createFileRoute('/import/')({
        loader: ({ context }) => Promise.all([
          context.queryClient.ensureQueryData(notesListOptions()),
        ]),
        errorComponent: ImportError,
      })
      function ImportPage() {
        const notes = useQuery(notesListOptions()).data ?? []
      }`
    expect(unobservedReads(parse(covered))).toEqual([])
  })

  it('refuses that exemption when the loader is tolerant (Promise.allSettled)', () => {
    // `/`, `/planning` and `/analytics` load this way ON PURPOSE, so their
    // errorComponent never sees a query failure and the screen must guard by
    // hand. Granting coverage here would have re-opened T-027 (a) itself.
    const tolerant = `
      export const Route = createFileRoute('/')({
        loader: ({ context }) => Promise.allSettled([
          context.queryClient.ensureQueryData(dueCountsOptions()),
        ]),
        errorComponent: DashError,
      })
      function Dash() {
        const total = useQuery(dueCountsOptions()).data?.total ?? 0
      }`
    expect(unobservedReads(parse(tolerant))).toEqual([
      { factory: 'dueCountsOptions', how: 'discarded', line: 9 },
    ])
  })

  it('refuses that exemption when the route has no errorComponent', () => {
    const noErrorScreen = `
      export const Route = createFileRoute('/x')({
        loader: ({ context }) => context.queryClient.ensureQueryData(notesListOptions()),
      })
      function X() { const notes = useQuery(notesListOptions()).data ?? [] }`
    expect(unobservedReads(parse(noErrorScreen))).toEqual([
      { factory: 'notesListOptions', how: 'discarded', line: 5 },
    ])
  })

  it('refuses that exemption for prefetchQuery, which swallows its rejection', () => {
    const prefetched = `
      export const Route = createFileRoute('/n')({
        loader: ({ context }) => context.queryClient.prefetchQuery(aiSettingsOptions()),
        errorComponent: NoteError,
      })
      function Note() { const ai = useQuery(aiSettingsOptions()).data }`
    expect(unobservedReads(parse(prefetched))).toEqual([
      { factory: 'aiSettingsOptions', how: 'discarded', line: 6 },
    ])
  })

  it('ignores mutations and the query client itself', () => {
    const other = `
      const qc = useQueryClient()
      const mut = useMutation({ mutationFn: save })`
    expect(unobservedReads(parse(other))).toEqual([])
  })
})
