import { z } from 'zod'
import {
  CARD_SEARCH_LIMIT_DEFAULT,
  CARD_SEARCH_QUERY_MAX,
  fsrsStateNameSchema,
  type SearchCardsQuery,
} from '@engram/shared'

/**
 * URL state of the dedicated search screen (`/search`).
 *
 * EVERY filter lives in the URL, deliberately: a search is a thing you send to
 * yourself, reload, and come back to with the browser's Back button. Component
 * state would lose all three. The only thing NOT in the URL is the multi-select
 * (see `selection.ts`) — a list of ids is not a view, and 500 of them would not
 * fit in a link anyone could paste.
 *
 * Every field is `.catch()`-guarded: a hand-edited or truncated link degrades to
 * the neutral screen instead of throwing a route error at someone who only
 * mistyped a query string. TanStack Router parses `?overdue=true` and `?page=2`
 * into a real boolean/number before Zod sees them, hence the non-string types.
 */
export const searchRouteSchema = z.object({
  /** The needle. Empty is legitimate — see `isSearching`. */
  q: z.string().max(CARD_SEARCH_QUERY_MAX).catch(''),
  subject: z.string().min(1).optional().catch(undefined),
  deck: z.string().min(1).optional().catch(undefined),
  state: fsrsStateNameSchema.optional().catch(undefined),
  /** Only the backlog (due before local midnight). Never sent as `false`. */
  overdue: z.boolean().optional().catch(undefined),
  /**
   * Hide cards filed under an ARCHIVED subject. Off by default: archiving means
   * "out of rotation", not "deleted", and a card you cannot find reads as data
   * loss. Sent to the server as a WHERE predicate, so `total` and the page count
   * the same population and a full page is genuinely full.
   */
  hideArchived: z.boolean().optional().catch(undefined),
  /** 1-based page. `offset` is derived — a page number survives a limit change. */
  page: z.number().int().min(1).catch(1),
  /** Deep-linked card editor. Absent = closed; Back closes it (T-030). */
  edit: z.string().min(1).optional().catch(undefined),
})

export type SearchRouteSearch = z.infer<typeof searchRouteSchema>

/** Neutral state of the screen — what "clear everything" resets to. */
export const EMPTY_SEARCH: SearchRouteSearch = { q: '', page: 1 }

/** Rows per page. The server's own default, so `limit` is never a surprise. */
export const SEARCH_PAGE_SIZE = CARD_SEARCH_LIMIT_DEFAULT

/** The needle actually sent — trimmed exactly like the server trims it. */
export function needleOf(q: string): string {
  return q.trim()
}

/**
 * Is any CORPUS filter set? `hideArchived` counts like the rest — it narrows the
 * queried population, not just the rendering. `page` and `edit` do not: they are
 * positions, not filters.
 */
export function hasFilters(s: SearchRouteSearch): boolean {
  return Boolean(s.subject || s.deck || s.state || s.overdue || s.hideArchived)
}

/**
 * Is the screen ASKING something? A needle or a filter, either alone is enough
 * — "every overdue card of this subject" is a real question with no needle, and
 * the server's contract exists precisely to answer it in one call.
 *
 * When this is false the screen shows its idle prompt rather than paging
 * through the whole corpus by accident.
 */
export function isSearching(s: SearchRouteSearch): boolean {
  return needleOf(s.q).length > 0 || hasFilters(s)
}

/** Filters worth counting on a "clear" affordance (not the needle). */
export function activeFilterCount(s: SearchRouteSearch): number {
  return [s.subject, s.deck, s.state, s.overdue, s.hideArchived].filter(Boolean).length
}

/**
 * URL state → the query the API takes.
 *
 * NEITHER `overdue: false` NOR `hideArchived: false` is ever sent, but for two
 * different reasons, and the difference matters to whoever reads this next:
 *
 *  - `hideArchived=false` is an explicit restatement of the server's default
 *    (archived subjects included), so sending it would add a parameter that
 *    changes nothing to every shareable link.
 *  - `overdue=false` DOES mean something to the server — "not late yet", the
 *    complement of the backlog. We never send it because the SCREEN chose a
 *    two-position chip: absent or `true`. A tri-state chip in a filter row has
 *    no readable "off" (is grey "no filter" or "not overdue"?) and cycles
 *    through a state nobody aimed for. This is an INTERFACE decision, not a
 *    limit of the contract — see `overdue` in `packages/shared/src/search.ts`.
 *    Turning it into a third position needs a control that can show three
 *    states, not just a change here.
 */
export function toApiQuery(
  s: SearchRouteSearch,
  limit = SEARCH_PAGE_SIZE,
): SearchCardsQuery & { limit: number; offset: number } {
  return {
    q: needleOf(s.q),
    ...(s.subject ? { subjectId: s.subject } : {}),
    ...(s.deck ? { deckId: s.deck } : {}),
    ...(s.state ? { state: s.state } : {}),
    ...(s.overdue ? { overdue: true } : {}),
    ...(s.hideArchived ? { hideArchived: true } : {}),
    limit,
    offset: (s.page - 1) * limit,
  }
}

/** Total pages for a match count (at least one, so page 1 always exists). */
export function pageCount(total: number, limit = SEARCH_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / limit))
}
