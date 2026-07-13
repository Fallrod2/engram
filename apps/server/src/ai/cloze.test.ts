import { describe, expect, it } from 'vitest'
import { expandCloze, looksLikeCloze, MAX_CLOZE_MASKS } from './cloze'

/** Small helper: assert ok and return the cards. */
function cards(text: string) {
  const r = expandCloze(text)
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`)
  return r.cards
}

describe('looksLikeCloze', () => {
  it('true when a {{cN::…}} opener is present', () => {
    expect(looksLikeCloze('Un {{c1::monoïde}}.')).toBe(true)
  })
  it('false for plain text', () => {
    expect(looksLikeCloze('juste du texte')).toBe(false)
    expect(looksLikeCloze('des accolades {a} et {{ sans masque')).toBe(false)
  })
})

describe('expandCloze — single mask', () => {
  it('one mask → one card; front blanks it, back bolds the answer, context kept', () => {
    const [c] = cards('Le code HTTP {{c1::404}} signifie introuvable.')
    expect(c!.maskIndex).toBe(1)
    expect(c!.front).toBe('Le code HTTP **[…]** signifie introuvable.')
    expect(c!.back).toBe('Le code HTTP **404** signifie introuvable.')
  })
})

describe('expandCloze — multiple distinct masks', () => {
  it('3 masks → 3 cards; each blanks its own, shows the OTHER answers in clear', () => {
    const out = cards(
      'Un {{c1::monoïde}} a une loi {{c2::associative}} et un élément {{c3::neutre}}.',
    )
    expect(out).toHaveLength(3)
    expect(out.map((c) => c.maskIndex)).toEqual([1, 2, 3])
    // Card for c1: c1 blanked, c2/c3 in clear.
    expect(out[0]!.front).toBe('Un **[…]** a une loi associative et un élément neutre.')
    expect(out[0]!.back).toBe('Un **monoïde** a une loi associative et un élément neutre.')
    // Card for c2: c2 blanked, c1/c3 in clear.
    expect(out[1]!.front).toBe('Un monoïde a une loi **[…]** et un élément neutre.')
    expect(out[1]!.back).toBe('Un monoïde a une loi **associative** et un élément neutre.')
  })

  it('non-contiguous numbers (c1, c3) → 2 cards, ascending order', () => {
    const out = cards('{{c1::A}} au milieu {{c3::B}}.')
    expect(out.map((c) => c.maskIndex)).toEqual([1, 3])
  })
})

describe('expandCloze — duplicated mask number = same card', () => {
  it('c1 repeated → ONE card; both occurrences blank/bold together', () => {
    const out = cards('{{c1::rouge}} puis encore {{c1::rouge}}.')
    expect(out).toHaveLength(1)
    expect(out[0]!.front).toBe('**[…]** puis encore **[…]**.')
    expect(out[0]!.back).toBe('**rouge** puis encore **rouge**.')
  })

  it('c1 repeated with different answers → one card, each occurrence its own bold', () => {
    const out = cards('{{c1::A}} et {{c1::B}}.')
    expect(out).toHaveLength(1)
    expect(out[0]!.back).toBe('**A** et **B**.')
  })
})

describe('expandCloze — Markdown / LaTeX inside the template', () => {
  it('preserves surrounding Markdown and inline code', () => {
    const [c] = cards('La fonction `map` a une complexité {{c1::O(n)}} **en général**.')
    expect(c!.front).toBe('La fonction `map` a une complexité **[…]** **en général**.')
    expect(c!.back).toBe('La fonction `map` a une complexité **O(n)** **en général**.')
  })

  it('single LaTeX braces in the literal text are NOT treated as broken syntax', () => {
    const [c] = cards('La somme {{c1::\\sum_i x_i}} apparaît dans \\frac{a}{b}.')
    expect(c!.front).toBe('La somme **[…]** apparaît dans \\frac{a}{b}.')
    expect(c!.back).toBe('La somme **\\sum_i x_i** apparaît dans \\frac{a}{b}.')
  })
})

describe('expandCloze — malformed input degrades gracefully (never throws)', () => {
  it('0 masks → rejected', () => {
    const r = expandCloze('aucun trou ici')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/aucun masque/)
  })

  it('empty answer {{c1::}} → rejected', () => {
    const r = expandCloze('un trou vide {{c1::}} ici')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/vide/)
  })

  it('stray double-brace / unbalanced token → rejected', () => {
    expect(expandCloze('{{c1::ok}} mais {{c2::cassé').ok).toBe(false)
    expect(expandCloze('reste }} orphelin {{c1::ok}}').ok).toBe(false)
  })

  it('nested-brace answer (forbidden) does not match → rejected', () => {
    // The inner braces break the token; nothing valid parses.
    const r = expandCloze('valeur {{c1::f{x}}} ici')
    expect(r.ok).toBe(false)
  })

  it(`more than the hard bound (${MAX_CLOZE_MASKS}) distinct masks → rejected`, () => {
    const many = Array.from({ length: MAX_CLOZE_MASKS + 1 }, (_, i) => `{{c${i + 1}::x${i}}}`).join(
      ' ',
    )
    const r = expandCloze(many)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/trop de masques/)
  })

  it(`exactly the hard bound (${MAX_CLOZE_MASKS}) distinct masks → accepted`, () => {
    const at = Array.from({ length: MAX_CLOZE_MASKS }, (_, i) => `{{c${i + 1}::x${i}}}`).join(' ')
    const r = expandCloze(at)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.cards).toHaveLength(MAX_CLOZE_MASKS)
  })
})
