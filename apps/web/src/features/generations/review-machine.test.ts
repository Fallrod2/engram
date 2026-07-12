import { describe, expect, it } from 'vitest'
import type { GenerationItem } from '@engram/shared'
import {
  canUndo,
  countReview,
  initReviewItems,
  reviewReducer,
  toResolvePayload,
  type ReviewItem,
} from './review-machine'

function items(...over: Partial<GenerationItem>[]): GenerationItem[] {
  return over.map((o, i) => ({
    id: o.id ?? `i${i}`,
    front: o.front ?? `front ${i}`,
    back: o.back ?? `back ${i}`,
    status: o.status ?? 'pending',
    ...(o.cardId !== undefined ? { cardId: o.cardId } : {}),
  }))
}

function statuses(list: ReviewItem[]): string[] {
  return list.map((i) => i.status)
}

describe('initReviewItems', () => {
  it('mirrors server status and freezes items that carry a cardId', () => {
    const state = initReviewItems(items({}, { cardId: 'c1', status: 'accepted' }))
    expect(state[0]?.frozen).toBe(false)
    expect(state[1]?.frozen).toBe(true)
    expect(state[1]?.cardId).toBe('c1')
    expect(state.every((i) => i.history.length === 0)).toBe(true)
  })
})

describe('reviewReducer — accept / reject / edit', () => {
  it('accepts, rejects and edits by id', () => {
    let state = initReviewItems(items({ id: 'a' }, { id: 'b' }, { id: 'c' }))
    state = reviewReducer(state, { type: 'accept', id: 'a' })
    state = reviewReducer(state, { type: 'reject', id: 'b' })
    state = reviewReducer(state, { type: 'edit', id: 'c', front: 'Q', back: 'A' })
    expect(statuses(state)).toEqual(['accepted', 'rejected', 'edited'])
    expect(state[2]).toMatchObject({ front: 'Q', back: 'A', status: 'edited' })
  })

  it('reverting from rejected to accepted is a soft revision (not undo)', () => {
    let state = initReviewItems(items({ id: 'a' }))
    state = reviewReducer(state, { type: 'reject', id: 'a' })
    state = reviewReducer(state, { type: 'accept', id: 'a' })
    expect(state[0]?.status).toBe('accepted')
    // two mutations → two undo snapshots
    expect(state[0]?.history).toHaveLength(2)
  })
})

describe('reviewReducer — undo', () => {
  it('undo restores the previous status', () => {
    let state = initReviewItems(items({ id: 'a' }))
    state = reviewReducer(state, { type: 'accept', id: 'a' })
    state = reviewReducer(state, { type: 'undo', id: 'a' })
    expect(state[0]?.status).toBe('pending')
    expect(canUndo(state[0] as ReviewItem)).toBe(false)
  })

  it('undo of an edit restores the original content', () => {
    let state = initReviewItems(items({ id: 'a', front: 'orig', back: 'origB' }))
    state = reviewReducer(state, { type: 'edit', id: 'a', front: 'new', back: 'newB' })
    state = reviewReducer(state, { type: 'undo', id: 'a' })
    expect(state[0]).toMatchObject({ front: 'orig', back: 'origB', status: 'pending' })
  })

  it('undo on an untouched item is a no-op', () => {
    const state = initReviewItems(items({ id: 'a' }))
    expect(reviewReducer(state, { type: 'undo', id: 'a' })).toEqual(state)
  })
})

describe('reviewReducer — acceptAllPending', () => {
  it('accepts only the pending items, leaving decided ones untouched', () => {
    let state = initReviewItems(items({ id: 'a' }, { id: 'b' }, { id: 'c' }))
    state = reviewReducer(state, { type: 'reject', id: 'b' })
    state = reviewReducer(state, { type: 'acceptAllPending' })
    expect(statuses(state)).toEqual(['accepted', 'rejected', 'accepted'])
  })
})

describe('reviewReducer — frozen items are inert', () => {
  it('ignores every decision on an inserted item', () => {
    const state = initReviewItems(items({ id: 'a', cardId: 'card-1', status: 'accepted' }))
    for (const action of [
      { type: 'reject' as const, id: 'a' },
      { type: 'edit' as const, id: 'a', front: 'x', back: 'y' },
      { type: 'undo' as const, id: 'a' },
    ]) {
      expect(reviewReducer(state, action)).toEqual(state)
    }
  })
})

describe('countReview', () => {
  it('counts each bucket and toInsert = accepted + edited (non-frozen)', () => {
    let state = initReviewItems(
      items({ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }),
    )
    state = reviewReducer(state, { type: 'accept', id: 'a' })
    state = reviewReducer(state, { type: 'accept', id: 'b' })
    state = reviewReducer(state, { type: 'edit', id: 'c', front: 'q', back: 'a' })
    state = reviewReducer(state, { type: 'reject', id: 'd' })
    // 'e' left pending
    expect(countReview(state)).toEqual({
      accepted: 2,
      edited: 1,
      rejected: 1,
      pending: 1,
      toInsert: 3,
    })
  })

  it('a frozen accepted item counts in its bucket but not in toInsert', () => {
    const state = initReviewItems(items({ id: 'a', cardId: 'c1', status: 'accepted' }))
    expect(countReview(state)).toMatchObject({ accepted: 1, toInsert: 0 })
  })
})

describe('toResolvePayload', () => {
  it('emits every item with its current status/content and preserves cardId', () => {
    let state = initReviewItems(
      items({ id: 'a' }, { id: 'b', cardId: 'card-b', status: 'accepted' }),
    )
    state = reviewReducer(state, { type: 'edit', id: 'a', front: 'Q', back: 'A' })
    const payload = toResolvePayload(state)
    expect(payload).toEqual([
      { id: 'a', front: 'Q', back: 'A', status: 'edited' },
      { id: 'b', front: 'front 1', back: 'back 1', status: 'accepted', cardId: 'card-b' },
    ])
  })
})
