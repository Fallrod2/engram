import { describe, expect, it } from 'vitest'
import { computeOcrWarnings } from './vision'

describe('computeOcrWarnings', () => {
  it('no markers → no warnings', () => {
    expect(computeOcrWarnings('# Titre\n\ndu texte propre')).toEqual([])
  })

  it('counts [?] markers', () => {
    const w = computeOcrWarnings('la dérivée [?] de f, puis g [?] et h [?]')
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('3 marqueur(s) [?]')
  })

  it('reports one illisible passage (singular)', () => {
    const w = computeOcrWarnings('début [illisible] fin')
    expect(w).toEqual(['1 passage illisible'])
  })

  it('reports several illisible passages (plural) and is case-insensitive', () => {
    const w = computeOcrWarnings('[illisible] milieu [ILLISIBLE]')
    expect(w).toEqual(['2 passages illisibles'])
  })

  it('combines both kinds of markers', () => {
    const w = computeOcrWarnings('x [?] y [illisible] z [?]')
    expect(w).toHaveLength(2)
    expect(w[0]).toContain('2 marqueur(s) [?]')
    expect(w[1]).toBe('1 passage illisible')
  })
})
