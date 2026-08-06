import { describe, expect, it } from 'vitest'
import { flattenMarkdown } from './markdown'

describe('flattenMarkdown', () => {
  it('strips inline and block marks to a single text line', () => {
    expect(flattenMarkdown('# Titre')).toBe('Titre')
    expect(flattenMarkdown('**gras** et *italique*')).toBe('gras et italique')
    expect(flattenMarkdown('un `code` inline')).toBe('un code inline')
    expect(flattenMarkdown('- a\n- b\n- c')).toBe('a b c')
    expect(flattenMarkdown('voir [le lien](https://x.y)')).toBe('voir le lien')
  })

  it('collapses whitespace and trims', () => {
    expect(flattenMarkdown('  ligne   une\n\nligne  deux  ')).toBe('ligne une ligne deux')
  })

  it('never introduces HTML', () => {
    expect(flattenMarkdown('<b>x</b>')).toBe('<b>x</b>')
  })

  /**
   * T-036 — a fenced block used to become a single space, so a card whose front
   * IS code (the normal shape of a programming card) previewed as an EMPTY row
   * in the deck list, in search and in ⌘K. Empty and broken look the same.
   */
  describe('fenced code blocks', () => {
    it('shows the code instead of dropping it', () => {
      expect(flattenMarkdown('```c\nint main(void);\n```')).toBe('int main(void);')
    })

    it('a card that is ONLY a code block previews as something', () => {
      expect(flattenMarkdown('```\nSELECT 1;\n```')).not.toBe('')
    })

    it('keeps the surrounding prose around it', () => {
      expect(flattenMarkdown('**Signature ?**\n\n```ts\nconst x = 1\n```\nvoilà')).toBe(
        'Signature ? const x = 1 voilà',
      )
    })

    it('does not let the inline rules chew on the code', () => {
      // `#include` is not a heading, `*p` is not italic, `- 1` is not a bullet:
      // lifting the block out before those rules run is the whole point.
      expect(flattenMarkdown('```c\n#include <stdio.h>\nint *p;\n- 1\n```')).toBe(
        '#include <stdio.h> int *p; - 1',
      )
    })

    it('handles two blocks in one face without merging them', () => {
      expect(flattenMarkdown('```\na\n```\net\n```\nb\n```')).toBe('a et b')
    })

    it('an EMPTY block leaves no hole and no stray space', () => {
      expect(flattenMarkdown('avant\n```\n```\naprès')).toBe('avant après')
    })

    it('multi-line code collapses to one line, like everything else here', () => {
      expect(flattenMarkdown('```py\ndef f():\n    return 1\n```')).toBe('def f(): return 1')
    })
  })
})
