import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * Case- and accent-insensitive text folding, expressed in PORTABLE core SQL.
 *
 * WHY NOT `unaccent`. It was the first candidate and it was measured, not
 * assumed. Three findings killed it:
 *   1. A bare PGlite has NO `unaccent` — `CREATE EXTENSION unaccent` fails with
 *      « extension "unaccent" is not available ». PGlite does ship the bundle,
 *      but only if it is registered in the `new PGlite({ extensions })`
 *      constructor, which means teaching BOTH PGlite entry points
 *      (`db/test-db.ts` and `test-support/db-preload.ts`) about it, and any
 *      future one, or the whole suite dies on the migration.
 *   2. `unaccent(text)` is STABLE, not IMMUTABLE (it reads a dictionary), so it
 *      cannot appear in an index expression or a generated column without an
 *      IMMUTABLE wrapper function — verified: « functions in index expression
 *      must be marked IMMUTABLE ».
 *   3. It would put a `CREATE EXTENSION` (and a wrapper function) in `public` on
 *      the cloud project, i.e. new PostgREST-reachable surface, in a schema
 *      migration 0010 deliberately stripped bare.
 *
 * The expression below uses only `lower`, `replace` and `translate` — core,
 * IMMUTABLE, identical on PGlite / local Postgres / Supabase, and needing no
 * migration at all. It is therefore impossible for the three environments to
 * disagree about what "matches" means.
 *
 * `translate` maps one character to one character, so the ligatures that expand
 * to TWO letters (œ→oe, æ→ae, ß→ss, ĳ→ij) are handled by `replace` first —
 * « cœur » has to be findable by typing « coeur ».
 */

/**
 * Diacritic → base letter, 1:1. GENERATED from Unicode NFD decomposition over
 * U+00C0..U+024F (every code point whose NFD base is a single ASCII letter),
 * plus the stroke/bar letters NFD does NOT decompose (ø, đ, ħ, ł, ŧ, ı, ȷ, þ).
 * Never hand-edit a single character: the two strings must stay the same length
 * and aligned index-for-index, which `fold.test.ts` asserts.
 */
export const FOLD_FROM =
  'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳØøĐđÐðĦħŁłŦŧıȷÞþ'

export const FOLD_TO =
  'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyOoDdDdHhLlTtijTt'

/** Ligatures that expand to two letters — `translate` cannot express these. */
export const FOLD_LIGATURES: ReadonlyArray<readonly [string, string]> = [
  ['œ', 'oe'],
  ['æ', 'ae'],
  ['ß', 'ss'],
  ['ĳ', 'ij'],
]

/**
 * The SQL folding of a column or expression: lowercased, ligatures expanded,
 * diacritics stripped. The ONE definition — it is applied to the stored text AND
 * to the needle, so the two sides can never drift apart.
 */
export function foldSql(expr: SQLWrapper): SQL<string> {
  let e: SQL = sql`lower(${expr})`
  for (const [from, to] of FOLD_LIGATURES) {
    e = sql`replace(${e}, ${from}, ${to})`
  }
  return sql<string>`translate(${e}, ${FOLD_FROM}, ${FOLD_TO})`
}

/**
 * Neutralise the LIKE metacharacters of a user-typed needle so « 100% » searches
 * for a literal percent sign instead of matching everything.
 *
 * Backslash first, or the backslashes this very function adds would be escaped
 * again. `\` is LIKE's default escape character in Postgres, and the needle
 * travels as a BOUND PARAMETER (never interpolated into SQL text), so
 * `standard_conforming_strings` cannot change its meaning; `ESCAPE '\'` is still
 * stated explicitly at the call site rather than relied upon.
 */
export function escapeLike(needle: string): string {
  return needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * `<already-folded column> LIKE '%' || fold(needle) || '%'` — a substring match
 * that ignores case and accents.
 *
 * ASYMMETRIC ON PURPOSE. `foldedColumn` must be a column that is ALREADY folded
 * (`card.front_fold` / `card.back_fold`, maintained by Postgres as STORED
 * generated columns — see migration 0012); only the NEEDLE is folded here, and
 * being row-independent it is evaluated once per execution rather than once per
 * row. Folding the column here instead measured 744 ms against 2.4 ms on a
 * 5 000-card corpus, because `translate` is O(len(text) × len(table)) and the
 * table is 260 characters wide.
 *
 * Substring, not prefix and not full-text: this backs an incremental search box,
 * where typing « kle » must already surface « Kleene ».
 */
export function foldedLike(foldedColumn: SQLWrapper, needle: string): SQL<boolean> {
  const pattern = escapeLike(needle)
  return sql<boolean>`${foldedColumn} like '%' || ${foldSql(sql`${pattern}`)} || '%' escape '\\'`
}
