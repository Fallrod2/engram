// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * The demo boot sequence and, above all, its TIMING POLICY.
 *
 * Two promises are being pinned here and they pull in opposite directions:
 *
 *  - nobody who is not waiting is ever shown the waiting window, and no wait is
 *    ever invented (no minimum duration, no scripted steps);
 *  - and the window can NEVER spin forever — every path out of `working` is
 *    exercised below, including the one where nothing ever answers.
 *
 * Everything runs on fake timers, so "500 ms" here is the real constant, read
 * from the module rather than retyped.
 */

const { createDemoSession, primeDemoAccount, fetchDemoSeedStatus, setSession } = vi.hoisted(() => ({
  createDemoSession: vi.fn(),
  primeDemoAccount: vi.fn(),
  fetchDemoSeedStatus: vi.fn(),
  setSession: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ createDemoSession, primeDemoAccount, fetchDemoSeedStatus }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { setSession } }, AUTH_ENABLED_WEB: true }))

import {
  DEMO_BOOT_DEADLINE_MS,
  DEMO_BOOT_MIN_VISIBLE_MS,
  DEMO_BOOT_POLL_MS,
  DEMO_BOOT_WINDOW_DELAY_MS,
  demoBootStepStatus,
  useDemoBoot,
  type DemoBootState,
} from './use-demo-boot'

const TOKENS = { accessToken: 'acc', refreshToken: 'ref' }

/** A promise plus its resolver, so a test decides exactly when a call answers. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const onEnter = vi.fn()
  const failed: boolean[] = []
  const view = renderHook(() =>
    useDemoBoot({ onEnter, onFailedChange: (f) => void failed.push(f) }),
  )
  return { ...view, onEnter, failed }
}

/** Advance fake time AND flush the microtasks the awaited calls queue. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  createDemoSession.mockReset()
  primeDemoAccount.mockReset()
  fetchDemoSeedStatus.mockReset()
  setSession.mockReset()
  createDemoSession.mockResolvedValue(TOKENS)
  setSession.mockResolvedValue({ error: null })
  primeDemoAccount.mockResolvedValue({ userId: 'demo' })
  fetchDemoSeedStatus.mockResolvedValue({ state: 'pending', readyAt: null })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDemoBoot — the window is never shown to someone who is not waiting', () => {
  it('never opens for a boot that finishes before the threshold', async () => {
    const { result, onEnter } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS - 1)

    expect(result.current.windowOpen).toBe(false)
    expect(result.current.state.phase).toBe('ready')
    // …and it enters IMMEDIATELY: a window that never appeared owes no hold.
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('opens once the boot is still running at the threshold', async () => {
    const session = deferred<typeof TOKENS>()
    createDemoSession.mockReturnValue(session.promise)
    const { result } = setup()
    act(() => result.current.start())

    await tick(DEMO_BOOT_WINDOW_DELAY_MS - 1)
    expect(result.current.windowOpen).toBe(false)
    await tick(1)
    expect(result.current.windowOpen).toBe(true)
    expect(result.current.state).toEqual({ phase: 'working', step: 'session', server: null })
  })

  it('holds the window for the minimum visible time — and only in that band', async () => {
    const prime = deferred<{ userId: string }>()
    primeDemoAccount.mockReturnValue(prime.promise)
    const { result, onEnter } = setup()
    act(() => result.current.start())

    await tick(DEMO_BOOT_WINDOW_DELAY_MS) // window appears
    expect(result.current.windowOpen).toBe(true)
    await tick(100) // ready 100 ms after it appeared
    await act(async () => {
      prime.resolve({ userId: 'demo' })
    })
    expect(result.current.state.phase).toBe('ready')
    // Not yet: closing 100 ms after opening would read as a glitch, and the
    // 180 ms open animation would not even have finished.
    expect(onEnter).not.toHaveBeenCalled()
    await tick(DEMO_BOOT_MIN_VISIBLE_MS - 100)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('adds nothing once the window has been up longer than the minimum', async () => {
    const prime = deferred<{ userId: string }>()
    primeDemoAccount.mockReturnValue(prime.promise)
    const { result, onEnter } = setup()
    act(() => result.current.start())

    await tick(DEMO_BOOT_WINDOW_DELAY_MS + DEMO_BOOT_MIN_VISIBLE_MS + 500)
    await act(async () => {
      prime.resolve({ userId: 'demo' })
    })
    await tick(0)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })
})

describe('useDemoBoot — what it reports while it waits', () => {
  it('walks the three steps and surfaces the REAL server state', async () => {
    const prime = deferred<{ userId: string }>()
    primeDemoAccount.mockReturnValue(prime.promise)
    fetchDemoSeedStatus
      .mockResolvedValueOnce({ state: 'pending', readyAt: null })
      .mockResolvedValue({ state: 'seeding', readyAt: null })

    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS)

    // The first poll answers `pending`: the seed has not started yet.
    expect(result.current.state).toEqual({ phase: 'working', step: 'prepare', server: 'pending' })
    await tick(DEMO_BOOT_POLL_MS)
    // The second sees the seed's advisory lock held — the server IS working.
    expect(result.current.state).toEqual({ phase: 'working', step: 'prepare', server: 'seeding' })

    await act(async () => {
      prime.resolve({ userId: 'demo' })
    })
    expect(result.current.state.phase).toBe('ready')
  })

  it('accepts a `ready` poll as completion even if the priming call hangs', async () => {
    primeDemoAccount.mockReturnValue(deferred<{ userId: string }>().promise) // never settles
    fetchDemoSeedStatus.mockResolvedValue({
      state: 'ready',
      readyAt: new Date().toISOString(),
    })
    const { result, onEnter } = setup()
    act(() => result.current.start())

    await tick(DEMO_BOOT_WINDOW_DELAY_MS + DEMO_BOOT_MIN_VISIBLE_MS)
    expect(result.current.state.phase).toBe('ready')
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('a failing poll is not a failing boot', async () => {
    const prime = deferred<{ userId: string }>()
    primeDemoAccount.mockReturnValue(prime.promise)
    fetchDemoSeedStatus.mockRejectedValue(new Error('offline'))

    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + DEMO_BOOT_POLL_MS * 3)
    expect(result.current.state.phase).toBe('working')

    await act(async () => {
      prime.resolve({ userId: 'demo' })
    })
    expect(result.current.state.phase).toBe('ready')
  })
})

describe('useDemoBoot — it always resolves, and says something true when it fails', () => {
  it('reports a fast failure inline, WITHOUT opening a window for it', async () => {
    createDemoSession.mockRejectedValue(new Error('503'))
    const { result, failed, onEnter } = setup()
    act(() => result.current.start())
    await tick(1)

    expect(result.current.windowOpen).toBe(false)
    expect(failed).toContain(true)
    expect(onEnter).not.toHaveBeenCalled()
    // Past the threshold nothing pops up after the fact.
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 100)
    expect(result.current.windowOpen).toBe(false)
  })

  it('shows a slow session failure IN the window, with nothing to resume', async () => {
    const session = deferred<typeof TOKENS>()
    createDemoSession.mockReturnValue(session.promise)
    const { result, failed } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS)
    await act(async () => {
      session.reject(new Error('502'))
    })

    expect(result.current.windowOpen).toBe(true)
    expect(result.current.state).toEqual({
      phase: 'failed',
      failure: 'session',
      step: 'session',
      resumable: false,
    })
    // The window owns the message; the landing is not told to duplicate it.
    expect(failed).not.toContain(true)
  })

  it('installs the session LAST, after the data is confirmed', async () => {
    const prime = deferred<{ userId: string }>()
    primeDemoAccount.mockReturnValue(prime.promise)
    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS)

    // The landing (and this window) only survive because the browser is NOT
    // signed in yet: `routes/index.tsx` swaps the landing for the dashboard the
    // instant the auth status flips.
    expect(result.current.state).toMatchObject({ phase: 'working', step: 'prepare' })
    expect(setSession).not.toHaveBeenCalled()

    await act(async () => {
      prime.resolve({ userId: 'demo' })
    })
    expect(setSession).toHaveBeenCalledTimes(1)
  })

  it('treats a refused setSession as a failure and leaves NO session behind', async () => {
    setSession.mockResolvedValue({ error: { message: 'bad token' } })
    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 10)

    expect(result.current.state).toMatchObject({
      phase: 'failed',
      failure: 'install',
      // A token pair was granted, so retrying (or entering anyway) is real.
      resumable: true,
    })
  })

  it('never spins forever: the deadline turns an unanswered boot into an error', async () => {
    primeDemoAccount.mockReturnValue(deferred<{ userId: string }>().promise)
    fetchDemoSeedStatus.mockReturnValue(new Promise(() => {}))
    const { result, onEnter } = setup()
    act(() => result.current.start())

    await tick(DEMO_BOOT_DEADLINE_MS - 1)
    expect(result.current.state.phase).toBe('working')
    await tick(1)

    expect(result.current.state).toEqual({
      phase: 'failed',
      failure: 'timeout',
      step: 'prepare',
      // A token pair was granted — which is why "enter anyway" is offered and is
      // not an empty promise. Nothing was installed, so the visitor is NOT in a
      // half-signed-in state.
      resumable: true,
    })
    expect(setSession).not.toHaveBeenCalled()
    expect(result.current.windowOpen).toBe(true)
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('retries only what is still owed — a live session is not thrown away', async () => {
    primeDemoAccount.mockRejectedValueOnce(new Error('500'))
    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 10)
    expect(result.current.state).toMatchObject({ phase: 'failed', failure: 'prepare' })
    expect(createDemoSession).toHaveBeenCalledTimes(1)

    primeDemoAccount.mockResolvedValue({ userId: 'demo' })
    act(() => result.current.retry())
    await tick(DEMO_BOOT_MIN_VISIBLE_MS + 10)

    // No second `POST /demo/session`: it would burn a rate-limit slot and discard
    // a perfectly good session.
    expect(createDemoSession).toHaveBeenCalledTimes(1)
    expect(result.current.state.phase).toBe('ready')
  })

  it('retries from the top when no session was ever opened', async () => {
    createDemoSession.mockRejectedValueOnce(new Error('503'))
    const { result } = setup()
    act(() => result.current.start())
    await tick(1)
    act(() => result.current.retry())
    await tick(10)

    expect(createDemoSession).toHaveBeenCalledTimes(2)
  })

  it('dismissing closes the window and hands the message back to the landing', async () => {
    primeDemoAccount.mockRejectedValue(new Error('500'))
    const { result, failed } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 10)
    act(() => result.current.dismiss())

    expect(result.current.windowOpen).toBe(false)
    expect(failed.at(-1)).toBe(true)
    // Nothing was ever installed, so closing leaves a genuinely signed-out page.
    expect(setSession).not.toHaveBeenCalled()
  })

  it('"enter anyway" signs in with the token it holds, without waiting', async () => {
    primeDemoAccount.mockRejectedValue(new Error('500'))
    const { result, onEnter } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 10)
    expect(setSession).not.toHaveBeenCalled()

    act(() => result.current.enterAnyway())
    await tick(DEMO_BOOT_MIN_VISIBLE_MS + 10)

    expect(setSession).toHaveBeenCalledTimes(1)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('stops everything on unmount — no stray navigation after the page is gone', async () => {
    const prime = deferred<{ userId: string }>()
    primeDemoAccount.mockReturnValue(prime.promise)
    const { result, unmount, onEnter } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS)
    unmount()
    await act(async () => {
      prime.resolve({ userId: 'demo' })
    })
    await tick(DEMO_BOOT_MIN_VISIBLE_MS + 100)
    expect(onEnter).not.toHaveBeenCalled()
  })
})

describe('demoBootStepStatus', () => {
  const working = (step: 'session' | 'prepare' | 'install'): DemoBootState => ({
    phase: 'working',
    step,
    server: null,
  })

  it('marks earlier steps done, the current one active and later ones waiting', () => {
    expect(demoBootStepStatus(working('prepare'), 'session')).toBe('done')
    expect(demoBootStepStatus(working('prepare'), 'prepare')).toBe('active')
    expect(demoBootStepStatus(working('prepare'), 'install')).toBe('todo')
  })

  it('marks the step that broke, and only that one', () => {
    const state: DemoBootState = {
      phase: 'failed',
      failure: 'prepare',
      step: 'prepare',
      resumable: true,
    }
    expect(demoBootStepStatus(state, 'session')).toBe('done')
    expect(demoBootStepStatus(state, 'prepare')).toBe('failed')
    expect(demoBootStepStatus(state, 'install')).toBe('todo')
  })

  it('marks everything done once the boot is ready', () => {
    expect(demoBootStepStatus({ phase: 'ready' }, 'session')).toBe('done')
    expect(demoBootStepStatus({ phase: 'ready' }, 'install')).toBe('done')
  })
})

describe('useDemoBoot — "enter anyway" does not pretend the wait finished', () => {
  it('marks the step it gave up on as skipped, never as done', async () => {
    primeDemoAccount.mockRejectedValue(new Error('500'))
    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 10)

    act(() => result.current.enterAnyway())
    expect(demoBootStepStatus(result.current.state, 'prepare')).toBe('skipped')

    await tick(DEMO_BOOT_MIN_VISIBLE_MS + 10)
    // …and it is STILL skipped on the final frame, which is the one the visitor
    // actually reads on the way out.
    expect(result.current.state.phase).toBe('ready')
    expect(demoBootStepStatus(result.current.state, 'prepare')).toBe('skipped')
    expect(demoBootStepStatus(result.current.state, 'install')).toBe('done')
  })

  it('keeps the skip while it remains true, and drops it on a fresh attempt', async () => {
    primeDemoAccount.mockRejectedValue(new Error('500'))
    setSession.mockResolvedValue({ error: { message: 'bad token' } })
    const { result } = setup()
    act(() => result.current.start())
    await tick(DEMO_BOOT_WINDOW_DELAY_MS + 10)
    act(() => result.current.enterAnyway())
    await tick(10)
    // The install failed, so retry retries the INSTALL — and `prepare` is still
    // something we never waited for, so it must not turn green.
    expect(result.current.state).toMatchObject({ phase: 'failed', failure: 'install' })
    act(() => result.current.retry())
    await tick(10)
    expect(demoBootStepStatus(result.current.state, 'prepare')).toBe('skipped')

    // A fresh click starts from a clean slate.
    act(() => result.current.start())
    expect(demoBootStepStatus(result.current.state, 'prepare')).toBe('todo')
  })
})
