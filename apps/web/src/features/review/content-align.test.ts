import { describe, expect, it } from 'vitest'
import type { MarkdownAlign } from '@/components/markdown'
import { contentAlign } from './content-align'

type Case = readonly [label: string, source: string, expected: MarkdownAlign]

/** Short, structure-free fragments — the only shape centering is defensible for. */
const CENTERED: readonly Case[] = [
  ['a bare term', 'Monomorphisme', 'center'],
  ['a one-line question', 'Quelle est la complexité de Dijkstra avec un tas binaire ?', 'center'],
  ['inline math', 'La dérivée de $x^2$', 'center'],
  ['inline emphasis only', 'Un **automate** fini déterministe', 'center'],
  ['surrounding whitespace is trimmed before measuring', '  \n  Lemme de pompage\n  ', 'center'],
  ['an empty string', '', 'center'],
  ['whitespace only', '   \n\t  \n ', 'center'],
  [`exactly ${120} chars`, 'a'.repeat(120), 'center'],
]

/** Anything with a reading edge to hold, or too long to scan without one. */
const LEFT_ALIGNED: readonly Case[] = [
  ['200 characters', 'a'.repeat(200), 'start'],
  [`${121} chars, one over the cap`, 'a'.repeat(121), 'start'],
  ['a bullet list', '- premier point\n- second point', 'start'],
  ['a single bullet, no newline', '- un seul point', 'start'],
  ['a `*` bullet', '* étoile', 'start'],
  ['a `+` bullet', '+ plus', 'start'],
  ['an ordered list', '1. première étape\n2. seconde étape', 'start'],
  ['an ordered list with `)`', '1) première étape', 'start'],
  ['a bullet indented by up to 3 spaces', '   - décalé', 'start'],
  ['a fenced code block', '```ts\nconst x = 1\n```', 'start'],
  ['a `~~~` fence', '~~~\nplain\n~~~', 'start'],
  ['a GFM table', '| Terme | Sens |\n| --- | --- |\n| a | b |', 'start'],
  ['a heading', '# Titre', 'start'],
  ['a blockquote', '> une citation', 'start'],
  ['display math', '$$\\int_0^1 x\\,dx$$', 'start'],
  ['two paragraphs', 'Premier paragraphe.\n\nSecond paragraphe.', 'start'],
  ['a hard line break inside one logical line', 'Ligne un  \nligne deux', 'start'],
]

describe('contentAlign', () => {
  it.each(CENTERED)('centers %s', (_label, source, expected) => {
    expect(contentAlign(source)).toBe(expected)
  })

  it.each(LEFT_ALIGNED)('left-aligns %s', (_label, source, expected) => {
    expect(contentAlign(source)).toBe(expected)
  })

  it('evaluates front and back independently', () => {
    const front = 'Théorème de Rice'
    const back = '- toute propriété non triviale\n- des langages récursivement énumérables'
    expect(contentAlign(front)).toBe('center')
    expect(contentAlign(back)).toBe('start')
  })
})
