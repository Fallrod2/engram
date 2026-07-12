import { describe, expect, it } from 'vitest'
import { hashKey } from '@tanstack/react-query'
import { qk } from '@/lib/query-keys'

/**
 * The `now` must be part of the preview key (finding #5, §16.1 item 11bis): two
 * prefetches of the same card at different `now` must not collide in the cache.
 */
describe('qk.review.preview — now is part of the key', () => {
  it('distinguishes two `now` values for the same card', () => {
    const a = qk.review.preview('card-1', '2026-07-12T10:00:00.000Z')
    const b = qk.review.preview('card-1', '2026-07-12T10:05:00.000Z')
    expect(hashKey(a)).not.toBe(hashKey(b))
  })

  it('is stable for the same card and now', () => {
    const a = qk.review.preview('card-1', '2026-07-12T10:00:00.000Z')
    const b = qk.review.preview('card-1', '2026-07-12T10:00:00.000Z')
    expect(hashKey(a)).toBe(hashKey(b))
  })
})

describe('qk.review.queue — scope + now identity', () => {
  it('is stable for the same scope + now', () => {
    const a = qk.review.queue({ subjectId: 's1', now: 'n' })
    const b = qk.review.queue({ subjectId: 's1', now: 'n' })
    expect(hashKey(a)).toBe(hashKey(b))
  })

  it('different scopes hash differently', () => {
    const deck = qk.review.queue({ deckId: 'd1', now: 'n' })
    const subject = qk.review.queue({ subjectId: 'd1', now: 'n' })
    expect(hashKey(deck)).not.toBe(hashKey(subject))
  })

  it('different `now` (a new session) hashes differently for the same scope', () => {
    const a = qk.review.queue({ subjectId: 's1', now: 'n1' })
    const b = qk.review.queue({ subjectId: 's1', now: 'n2' })
    expect(hashKey(a)).not.toBe(hashKey(b))
  })
})
