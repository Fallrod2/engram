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
})
