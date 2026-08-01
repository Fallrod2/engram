/**
 * Which of its three renderings a panel of `/analytics` is showing.
 *
 * ═══ WHY THIS IS A FUNCTION AND NOT A TERNARY ═══
 *
 * T-066 gave every panel on this screen an error state, because the route loads
 * through `Promise.allSettled` on purpose — no failure ever reaches
 * `AnalyticsError` — and a panel gated on `data ? … : <Skeleton/>` therefore
 * shimmered until the tab was closed. The gates became `data || isError`.
 *
 * That was correct and completely unprotected. Measured, gate by gate: dropping
 * the `|| isError` term from ANY of the seven panels left the whole suite green.
 * Not because nobody looked, but because of how the two things that could have
 * looked are built:
 *
 *   · `read-guard.test.ts` asks whether SOME status member is read on the
 *     handle, not whether a particular branch is. Every panel here also reads
 *     `isFetching` for the refetch dimming and passes `error={q.isError}` down
 *     to the component, so the gate's own term is redundant to that scan and
 *     can be deleted without it noticing.
 *   · a route component reads its own URL search params, so asserting the gate
 *     directly means mounting a router — which this repo does nowhere.
 *
 * So the decision moves here, where it can be asserted, and the route consumes
 * the answer. The argument is the QUERY HANDLE, deliberately: there is then no
 * `|| isError` at the call site left to drop, and the regression the reviewer
 * measured stops being expressible. This is the same move `searchBody` makes in
 * `features/search/results.ts`, and it is why `/search` did not have this hole.
 *
 * ═══ THE RULE ═══
 *
 * `data` wins. A panel holding a payload renders it, even if a LATER refetch
 * failed (TanStack keeps the last good value) and even if a dependency is
 * missing — the component decides for itself what to do with a partial answer.
 * Failure comes next. The skeleton is last and means one thing only: still
 * waiting, nothing broken. That order is the whole content of T-066.
 */
export type PanelBody = 'skeleton' | 'error' | 'data'

/**
 * The part of a `useQuery` result this decision needs. Structural on purpose so
 * a caller can pass the handle itself (`panelBody(heatmapQuery)`) or, for the
 * KPI row whose four tiles are fed by five reads, a combination of several.
 */
export interface PanelRead {
  /** `undefined` is TanStack's own "nothing has landed yet". */
  data: unknown
  isError: boolean
}

export function panelBody(read: PanelRead, dependencyFailed = false): PanelBody {
  if (read.data !== undefined) return 'data'
  // `dependencyFailed` is a read this panel needs but does not own — the subject
  // list, which three panels resolve their row names through. Its failure is
  // this panel's failure: without it they drop every row they cannot name, and
  // an empty panel then blames the user's history for a dropped request.
  if (read.isError || dependencyFailed) return 'error'
  return 'skeleton'
}
