import { describe, expect, it } from 'vitest'
import { cn, mergeDefined } from './utils'

/**
 * Pins the `extendTailwindMerge` config behind `cn`. tailwind-merge classifies a
 * `text-*` utility by shape, and the card reading scale (`text-card`,
 * `text-card-sm`, `text-card-md`, `text-card-lg`) does not look like a t-shirt
 * size — so without the explicit `font-size` registration it is filed as a *text
 * color*. The breakage is silent and visual, never a type or lint error:
 *
 * - `cn('text-text', 'text-card')` collapses to `text-card` alone and the
 *   Markdown wrapper loses its base color (card body renders in the inherited
 *   color instead of `--color-text`);
 * - `cn('[&_h4]:text-card-sm', '[&_h4]:text-text-muted')` collapses to the color
 *   alone and card `h4`s silently fall back to the app font size.
 *
 * The last two cases guard the other direction: registering the tokens must not
 * stop real t-shirt sizes from conflicting, nor make sizes eat text colors.
 */
describe('cn — card type scale is registered as a font size', () => {
  it('keeps a card size and a text color together (they are not the same group)', () => {
    const merged = cn('text-text', 'text-card')
    expect(merged).toContain('text-text')
    expect(merged).toContain('text-card')
  })

  it('keeps a card size and a text color together under the same variant', () => {
    const merged = cn('[&_h4]:text-card-sm', '[&_h4]:text-text-muted')
    expect(merged).toContain('[&_h4]:text-card-sm')
    expect(merged).toContain('[&_h4]:text-text-muted')
  })

  it('resolves a card size against an app size, last-wins', () => {
    expect(cn('text-sm', 'text-card')).toBe('text-card')
    expect(cn('text-card', 'text-sm')).toBe('text-sm')
    expect(cn('text-card-sm', 'text-card-lg')).toBe('text-card-lg')
  })

  it('leaves the pre-existing size and color groups untouched', () => {
    expect(cn('text-md', 'text-2xs')).toBe('text-2xs')
    expect(cn('text-text-muted', 'text-text')).toBe('text-text')
  })
})

describe('mergeDefined', () => {
  it('overwrites only defined patch fields (optimistic updates)', () => {
    const base = { name: 'A', description: 'old', position: 1 }
    expect(mergeDefined(base, { name: 'B' })).toEqual({
      name: 'B',
      description: 'old',
      position: 1,
    })
  })

  it('ignores undefined values so they never clobber the base', () => {
    const base = { name: 'A', description: 'keep' as string | null }
    expect(mergeDefined(base, { description: undefined })).toEqual({
      name: 'A',
      description: 'keep',
    })
  })
})
