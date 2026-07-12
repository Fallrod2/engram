import { describe, expect, it } from 'vitest'
import { dictFr } from './dict.fr'
import { dictEn } from './dict.en'

/** Recursively collect every dot-path leaf key of a nested string dictionary. */
function leafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push(path)
    else if (v && typeof v === 'object') out.push(...leafPaths(v as Record<string, unknown>, path))
  }
  return out.sort()
}

describe('i18n dictionary parity', () => {
  it('fr and en expose exactly the same key set', () => {
    // Typecheck already forces `dictEn: Dict`, but this proves parity at runtime
    // and catches an EN value accidentally left as an object/number.
    expect(leafPaths(dictEn)).toEqual(leafPaths(dictFr))
  })

  it('no leaf is left empty in either language', () => {
    for (const dict of [dictFr, dictEn]) {
      for (const path of leafPaths(dict as Record<string, unknown>)) {
        const value = path
          .split('.')
          .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], dict)
        expect(value, path).not.toBe('')
      }
    }
  })
})
