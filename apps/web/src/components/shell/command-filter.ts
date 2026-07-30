import { defaultFilter } from 'cmdk'

/**
 * Scoring for the ⌘K palette, now that it holds two kinds of row.
 *
 * THE PROBLEM. cmdk scores every item against the input with `command-score`,
 * then physically re-appends items and groups in score order. Card results do
 * not belong in that contest: they were matched by Postgres, accent- and
 * case-insensitively, over text the palette never sees in full (the back of the
 * card). Letting cmdk re-score them would drop rows the server found — the
 * exact « ⌘K says no results while the card exists » bug T-030 is about.
 *
 * THE RULE. A card row is identified by its value prefix and always scores
 * `CARD_SCORE`, so it is visible and keeps the server's ordering (Array#sort is
 * stable, so equal scores preserve DOM order — front-matches first, as the
 * service promises). Everything else keeps cmdk's own scoring, FLOORED above
 * the card score.
 *
 * The floor is the load-bearing half. Without it a deep, gappy fuzzy match
 * (`command-score` multiplies a 0.17 factor per character jump, so eight of
 * them land near 1e-6) could score BELOW a card row and drag the Cards group
 * above Navigation — the actions the user already had would jump under a list
 * that arrived 200 ms later. With it, any item cmdk considers a match at all
 * outranks every card row, so the Cards group is always last and the rows above
 * it never move. Two matches both under the floor tie, which costs nothing:
 * at that score they are indistinguishable noise anyway.
 */
export const CARD_ITEM_PREFIX = 'engram-card::'

/** Constant score of a server-matched card row. Positive ⇒ never hidden. */
export const CARD_SCORE = 1e-6
/** Lower bound applied to every non-card match, strictly above `CARD_SCORE`. */
export const MATCH_FLOOR = CARD_SCORE * 10

export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(CARD_ITEM_PREFIX)) return CARD_SCORE
  const score = defaultFilter(value, search, keywords)
  return score > 0 ? Math.max(score, MATCH_FLOOR) : 0
}

/** The cmdk `value` of a card row — opaque, stable, and never user-visible. */
export function cardItemValue(cardId: string): string {
  return `${CARD_ITEM_PREFIX}${cardId}`
}
