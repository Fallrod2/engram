import { z } from 'zod'
import { cardSchema, colorHexSchema } from './domain'

/**
 * Contract for content search (`GET /api/cards/search`) and the bulk card
 * operations the dedicated search screen drives (`POST /api/cards/bulk/*`).
 *
 * Single source of truth, like the rest of `@engram/shared`: the server parses
 * requests and validates responses against these schemas, the web infers its
 * types from them. Nothing here may be re-declared by hand on either side.
 */

// --- Search ----------------------------------------------------------------

/**
 * FSRS state as a NAME in the API, an integer in the database.
 *
 * The wire form is a name because `state=2` in a URL is unreadable and unstable:
 * it hard-codes a ts-fsrs enum value into every bookmark, link and front-end
 * call site. The mapping below is the only place the two representations meet,
 * and a server test guards it against the real `ts-fsrs` `State` enum — so a
 * ts-fsrs renumbering breaks the build instead of silently filtering the wrong
 * bucket.
 */
export const fsrsStateNameSchema = z.enum(['new', 'learning', 'review', 'relearning'])
export type FsrsStateName = z.infer<typeof fsrsStateNameSchema>

/** Name → ts-fsrs `State` integer. Guarded by `fsrs-enums.test.ts`. */
export const FSRS_STATE_BY_NAME: Readonly<Record<FsrsStateName, 0 | 1 | 2 | 3>> = Object.freeze({
  new: 0,
  learning: 1,
  review: 2,
  relearning: 3,
})

/** Server-side ceiling on `limit`. A client asking for more is rejected (400). */
export const CARD_SEARCH_LIMIT_MAX = 100
/** Applied when the caller omits `limit`. */
export const CARD_SEARCH_LIMIT_DEFAULT = 25
/**
 * Ceiling on the needle. Past a couple of hundred characters this is not a
 * search, it is someone pasting a document into the box (or probing); the
 * pattern would be scanned against every row of the corpus for nothing.
 */
export const CARD_SEARCH_QUERY_MAX = 200

/** `'true'`/`'false'` query string → boolean (same convention as `domain.ts`). */
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true')

/**
 * Query of `GET /api/cards/search`.
 *
 * `q` is REQUIRED but may be EMPTY — and the empty string is not a degenerate
 * case, it is the mode the dedicated screen opens in. An empty (or
 * whitespace-only) `q` drops the text predicate and returns the filtered corpus,
 * so "show me every overdue card of this subject" is one call and not a special
 * endpoint. The ⌘K palette simply never sends it.
 *
 * Matching is case- AND accent-insensitive over BOTH `front` and `back`
 * (see `foldedLike` server-side): « theorie » finds « Théorie ».
 */
export const searchCardsQuerySchema = z.object({
  q: z.string().max(CARD_SEARCH_QUERY_MAX),
  subjectId: z.string().min(1).optional(),
  deckId: z.string().min(1).optional(),
  state: fsrsStateNameSchema.optional(),
  /**
   * TRI-STATE, and every state does something — the parameter is named after a
   * PROPERTY OF THE CARD, so `false` reads as "cards that are not overdue" and
   * that is exactly what it now selects:
   *
   *   absent  → no due filter at all
   *   `true`  → only the backlog: `due <  local midnight today`
   *   `false` → only what is not late yet: `due >= local midnight today`
   *
   * It previously accepted `false` and silently ignored it, which made the
   * schema promise a filter it did not apply. The two halves partition the
   * corpus exactly (the cut is half-open, midnight belongs to today).
   */
  overdue: boolParam.optional(),
  /**
   * Exclude cards whose subject is archived. Named as an IMPERATIVE, so unlike
   * `overdue` its `false` is not a third case — it is an explicit restatement of
   * the default, and it does what it says:
   *
   *   absent / `false` → archived subjects INCLUDED (the default)
   *   `true`           → archived subjects excluded
   *
   * Archived cards are findable BY DEFAULT on purpose: archiving a subject means
   * "out of the review rotation", not "deleted", and a card you can no longer
   * find is indistinguishable from one that is gone. Hiding them is the user's
   * explicit choice, never the server's assumption.
   */
  hideArchived: boolParam.optional(),
  limit: z.coerce.number().int().min(1).max(CARD_SEARCH_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
export type SearchCardsQuery = z.infer<typeof searchCardsQuerySchema>

/**
 * One result row. Carries the deck and subject INLINE so a result list renders
 * with no second round-trip — the ⌘K palette needs the deck name as its
 * subtitle, and the dedicated screen needs the subject's colour for its chips.
 */
export const cardSearchHitSchema = z.object({
  card: cardSchema,
  deck: z.object({ id: z.string(), name: z.string() }),
  subject: z.object({
    id: z.string(),
    name: z.string(),
    color: colorHexSchema,
    icon: z.string(),
    archived: z.boolean(),
  }),
})
export type CardSearchHit = z.infer<typeof cardSearchHitSchema>

export const searchCardsResponseSchema = z.object({
  /** Size of the FULL match set, before `limit`/`offset` — drives pagination. */
  total: z.number().int().nonnegative(),
  /** Echoed back so a late response can be discarded by an incremental UI. */
  query: z.string(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hits: z.array(cardSearchHitSchema),
})
export type SearchCardsResponse = z.infer<typeof searchCardsResponseSchema>

// --- Bulk operations -------------------------------------------------------

/**
 * Ceiling on one batch. Refused franchement (400) beyond it rather than letting
 * a 100 000-id request build a statement no plan survives.
 */
export const CARD_BULK_MAX = 500

export const bulkCardIdsSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1).max(CARD_BULK_MAX),
})
export type BulkCardIds = z.infer<typeof bulkCardIdsSchema>

export const bulkMoveCardsSchema = bulkCardIdsSchema.extend({
  /** Destination deck. Must belong to the caller, under a non-archived subject. */
  deckId: z.string().min(1),
})
export type BulkMoveCards = z.infer<typeof bulkMoveCardsSchema>

/**
 * What actually happened — never a mute success.
 *
 * `requested` is the raw id count as sent; `affected` is the number of rows the
 * transaction actually wrote. They differ exactly when the caller sent
 * duplicates (a multi-select UI merging two pages can). They can never differ
 * because an id was skipped: an id that is not the caller's own aborts the whole
 * call with 404 and writes nothing.
 */
export const bulkCardResultSchema = z.object({
  requested: z.number().int().nonnegative(),
  affected: z.number().int().nonnegative(),
})
export type BulkCardResult = z.infer<typeof bulkCardResultSchema>
