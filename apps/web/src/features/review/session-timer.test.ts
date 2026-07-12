import { describe, expect, it } from 'vitest'
import { createCardTimer, IDLE_MS, MAX_CARD_MS } from './session-timer'

/** A controllable monotonic clock. */
function clock(start = 0) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('createCardTimer — active-time accounting (§16.1 item 7)', () => {
  it('sums only the segments outside pause', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(3000) // active
    timer.pause()
    c.advance(10_000) // paused — not counted
    timer.resume()
    c.advance(2000) // active
    expect(timer.read()).toBe(5000)
  })

  it('read() while running includes the open segment', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(1500)
    expect(timer.read()).toBe(1500)
  })
})

describe('createCardTimer — mounted paused (§16.1 item 7bis, finding #10)', () => {
  it('counts nothing until the first resume; an immediate rating yields 0', () => {
    const c = clock()
    const timer = createCardTimer(true, c.now) // ASKING(i+1) while tab hidden
    c.advance(30_000) // still hidden — must not count
    expect(timer.read()).toBe(0)
  })

  it('starts counting only from resume', () => {
    const c = clock()
    const timer = createCardTimer(true, c.now)
    c.advance(5000) // hidden
    timer.resume()
    c.advance(2000) // active
    expect(timer.read()).toBe(2000)
  })
})

describe('createCardTimer — pause mechanisms (§16.1 item 8)', () => {
  it('pause() (visibility, mechanism B) applies zero grace', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(4000)
    timer.pause() // grace 0 — keeps the 4s already counted
    expect(timer.read()).toBe(4000)
  })

  it('pauseIdle() (mechanism A) subtracts the IDLE_MS silent window', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(IDLE_MS + 5000) // 5s of real reading + 120s of silence
    timer.pauseIdle()
    expect(timer.read()).toBe(5000)
  })

  it('pauseIdle() never goes negative', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(1000) // less than the grace window
    timer.pauseIdle()
    expect(timer.read()).toBe(0)
  })

  it('resumes after an idle pause and keeps counting', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(IDLE_MS + 2000)
    timer.pauseIdle() // → 2000
    c.advance(50_000) // idle window, not counted
    timer.resume()
    c.advance(1000)
    expect(timer.read()).toBe(3000)
  })
})

describe('createCardTimer — invariants (§16.1 item 9)', () => {
  it('caps at MAX_CARD_MS', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(10 * MAX_CARD_MS)
    expect(timer.read()).toBe(MAX_CARD_MS)
  })

  it('read() is always a non-negative integer', () => {
    const c = clock()
    const timer = createCardTimer(false, c.now)
    c.advance(1234.6)
    const v = timer.read()
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
  })
})
