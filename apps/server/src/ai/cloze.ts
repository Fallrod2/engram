/**
 * Pure cloze-expansion module (spec §1, §2.3). Turns ONE Anki-style cloze
 * template `… {{c1::…}} … {{cN::…}} …` into N materialised front/back cards — one
 * per DISTINCT mask number — so the rest of the app (card table, session, FSRS,
 * backup) never learns cloze exists (the "façon quiz" light path).
 *
 * This is parsing of LLM-generated text: it MUST degrade gracefully. Every
 * malformed shape returns `{ ok: false, reason }` (the caller logs + skips the
 * item) rather than throwing or emitting a broken card. No React, no I/O — fully
 * unit-testable.
 */

/**
 * Hard upper bound on DISTINCT masks in one template. The prompt asks for ≤ 3,
 * but that instruction is not binding on the model; this defensive cap keeps the
 * pre-`MAX_TOTAL_ITEMS` amplification bounded (worst wire case: 24 cloze items ×
 * N masks) even if the model ignores the prompt. Above it → the item is rejected.
 */
export const MAX_CLOZE_MASKS = 6

/** Matches one well-formed mask: `{{c<positive int>::<answer without braces>}}`. */
const MASK_RE = /\{\{c(\d+)::([^{}]*)\}\}/g

/** Loose opener used to tell "this is meant to be a cloze" from a mislabel. */
const CLOZE_OPENER_RE = /\{\{c\d+::/

/** One materialised card for a single distinct mask number. */
export interface ClozeCard {
  /** The `N` of the `cN` this card blanks. */
  maskIndex: number
  /** Full text; this mask → `**[…]**`, the OTHER masks shown in clear. */
  front: string
  /** Full text; this mask → `**answer**` (bold), the OTHER masks in clear. */
  back: string
}

export type ClozeExpansion = { ok: true; cards: ClozeCard[] } | { ok: false; reason: string }

interface Token {
  idx: number
  answer: string
  start: number
  end: number
}

/** True iff the text is plausibly a cloze template (used by the parse gate). */
export function looksLikeCloze(text: string): boolean {
  return CLOZE_OPENER_RE.test(text)
}

/**
 * Expand a cloze template into one card per distinct mask number. Returns a
 * discriminated result: on any malformed input (no mask, empty answer, stray /
 * nested braces, too many masks) it reports `{ ok: false, reason }` so the job
 * can log the reason and drop just this item.
 */
export function expandCloze(clozeText: string): ClozeExpansion {
  const text = clozeText ?? ''

  // 1) Collect every well-formed mask token with its position.
  const tokens: Token[] = []
  MASK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MASK_RE.exec(text)) !== null) {
    const idx = Number(m[1])
    const answer = (m[2] ?? '').trim()
    if (idx < 1) return { ok: false, reason: `numéro de masque invalide (c${m[1]})` }
    if (answer.length === 0) return { ok: false, reason: 'masque à réponse vide' }
    tokens.push({ idx, answer, start: m.index, end: m.index + m[0].length })
  }

  if (tokens.length === 0) {
    return { ok: false, reason: 'aucun masque {{cN::…}} valide' }
  }

  // 2) Broken-syntax guard: strip the valid tokens and require the residual to
  //    carry no stray DOUBLE brace. A leftover `{{` / `}}` signals an unbalanced
  //    or nested (spec-forbidden) mask — reject rather than emit a half-blanked
  //    card. Single braces are left alone: literal Markdown/LaTeX (`\frac{a}{b}`)
  //    in the surrounding text is legitimate and must survive.
  let residual = ''
  let cursor = 0
  for (const t of tokens) {
    residual += text.slice(cursor, t.start)
    cursor = t.end
  }
  residual += text.slice(cursor)
  if (residual.includes('{{') || residual.includes('}}')) {
    return { ok: false, reason: 'syntaxe cloze cassée (accolades résiduelles)' }
  }

  // 3) Distinct mask numbers → one independent card each, ascending.
  const distinct = [...new Set(tokens.map((t) => t.idx))].sort((a, b) => a - b)
  if (distinct.length > MAX_CLOZE_MASKS) {
    return {
      ok: false,
      reason: `trop de masques distincts (${distinct.length} > ${MAX_CLOZE_MASKS})`,
    }
  }

  const cards: ClozeCard[] = distinct.map((k) => ({
    maskIndex: k,
    front: renderFace(text, tokens, k, 'front'),
    back: renderFace(text, tokens, k, 'back'),
  }))
  return { ok: true, cards }
}

/**
 * Rebuild the template for the card of mask `k`: the `k` occurrences become the
 * blank (`**[…]**`) or the bold answer (`**answer**`); every OTHER mask is shown
 * in clear (its answer, no braces). Literal segments pass through untouched, so
 * Markdown/LaTeX in the template survives verbatim.
 */
function renderFace(text: string, tokens: Token[], k: number, face: 'front' | 'back'): string {
  let out = ''
  let cursor = 0
  for (const t of tokens) {
    out += text.slice(cursor, t.start)
    if (t.idx === k) {
      out += face === 'front' ? '**[…]**' : `**${t.answer}**`
    } else {
      out += t.answer
    }
    cursor = t.end
  }
  out += text.slice(cursor)
  return out
}
