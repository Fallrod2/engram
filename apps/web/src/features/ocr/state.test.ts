import { describe, expect, it } from 'vitest'
import { initOcrState, ocrReducer, PAGE_SEPARATOR, type OcrState } from './state'

function seed(): OcrState {
  return initOcrState([
    { id: 'a', name: 'p1.jpg' },
    { id: 'b', name: 'p2.jpg' },
  ])
}

describe('ocrReducer — freeze rule (§3.3.1)', () => {
  it('re-assembles the textarea from segments in order while not dirty', () => {
    let s = seed()
    s = ocrReducer(s, { type: 'resolved', id: 'a', segment: 'Page A', warnings: [] })
    expect(s.assembledText).toBe('Page A')
    s = ocrReducer(s, { type: 'resolved', id: 'b', segment: 'Page B', warnings: [] })
    expect(s.assembledText).toBe(`Page A${PAGE_SEPARATOR}Page B`)
    expect(s.dirty).toBe(false)
  })

  it('freezes on the first manual edit and never clobbers it with a late resolution', () => {
    let s = seed()
    s = ocrReducer(s, { type: 'resolved', id: 'a', segment: 'Page A', warnings: [] })
    // User corrects the textarea → definitive freeze.
    s = ocrReducer(s, { type: 'edit', text: 'Ma correction' })
    expect(s.dirty).toBe(true)
    // A still-pending page resolves AFTER the edit: textarea must stay intact.
    s = ocrReducer(s, {
      type: 'resolved',
      id: 'b',
      segment: 'Page B',
      warnings: [{ kind: 'uncertain', count: 1 }],
    })
    expect(s.assembledText).toBe('Ma correction')
    expect(s.staleSinceEdit).toBe(true)
    // But the segment IS captured (visible to a later re-apply).
    expect(s.pages.find((p) => p.id === 'b')?.segment).toBe('Page B')
  })

  it('re-apply order overwrites corrections on explicit demand and clears the flag', () => {
    let s = seed()
    s = ocrReducer(s, { type: 'resolved', id: 'a', segment: 'Page A', warnings: [] })
    s = ocrReducer(s, { type: 'edit', text: 'corr' })
    s = ocrReducer(s, { type: 'resolved', id: 'b', segment: 'Page B', warnings: [] })
    s = ocrReducer(s, { type: 'reapplyOrder' })
    expect(s.assembledText).toBe(`Page A${PAGE_SEPARATOR}Page B`)
    expect(s.staleSinceEdit).toBe(false)
    expect(s.dirty).toBe(true) // stays editable
  })
})

describe('ocrReducer — reorder / remove', () => {
  it('reordering while not dirty re-assembles in the new order', () => {
    let s = seed()
    s = ocrReducer(s, { type: 'resolved', id: 'a', segment: 'A', warnings: [] })
    s = ocrReducer(s, { type: 'resolved', id: 'b', segment: 'B', warnings: [] })
    s = ocrReducer(s, { type: 'move', id: 'b', dir: -1 })
    expect(s.pages.map((p) => p.id)).toEqual(['b', 'a'])
    expect(s.assembledText).toBe(`B${PAGE_SEPARATOR}A`)
  })

  it('removing a page while not dirty drops its segment from the textarea', () => {
    let s = seed()
    s = ocrReducer(s, { type: 'resolved', id: 'a', segment: 'A', warnings: [] })
    s = ocrReducer(s, { type: 'resolved', id: 'b', segment: 'B', warnings: [] })
    s = ocrReducer(s, { type: 'remove', id: 'a' })
    expect(s.pages).toHaveLength(1)
    expect(s.assembledText).toBe('B')
  })

  it('a failed page never touches the textarea', () => {
    let s = seed()
    s = ocrReducer(s, { type: 'resolved', id: 'a', segment: 'A', warnings: [] })
    s = ocrReducer(s, { type: 'failed', id: 'b', error: 'boom' })
    expect(s.assembledText).toBe('A')
    expect(s.pages.find((p) => p.id === 'b')?.status).toBe('error')
  })
})
