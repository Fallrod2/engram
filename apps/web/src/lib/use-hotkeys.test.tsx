// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// TanStack Router is only used for the navigation-pending guard; stub it as
// permanently-idle so hotkeys are never suppressed for that reason here.
vi.mock('@tanstack/react-router', () => ({
  useRouterState: (opts: { select: (s: { status: string }) => unknown }) =>
    opts.select({ status: 'idle' }),
}))

import { useHotkeys, type HotkeysOptions } from './use-hotkeys'

/** Mount the hook, returning a dispatcher that fires a keydown on `target`. */
function mountHotkeys(map: Record<string, () => void>, options?: HotkeysOptions) {
  const handlers = Object.fromEntries(Object.entries(map).map(([k, fn]) => [k, () => fn()]))
  function Probe() {
    useHotkeys(handlers, options)
    return null
  }
  render(<Probe />)
}

/** Dispatch a keydown from `target` (defaults to document.body). */
function press(
  key: string,
  init: Partial<KeyboardEventInit> = {},
  target: HTMLElement = document.body,
) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

/** Attach an open Radix-style dialog to the DOM; returns a cleanup fn. */
function openDialog(role: 'dialog' | 'alertdialog' = 'dialog') {
  const el = document.createElement('div')
  el.setAttribute('role', role)
  el.setAttribute('data-state', 'open')
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('useHotkeys — modal guard', () => {
  it('fires a single-key hotkey when no modal surface is open', () => {
    const a = vi.fn()
    mountHotkeys({ a })
    press('a')
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('swallows a single-key hotkey while a dialog is open', () => {
    const a = vi.fn()
    mountHotkeys({ a })
    openDialog()
    press('a')
    expect(a).not.toHaveBeenCalled()
  })

  it('swallows a single-key hotkey while an alertdialog is open', () => {
    const a = vi.fn()
    mountHotkeys({ a })
    openDialog('alertdialog')
    press('a')
    expect(a).not.toHaveBeenCalled()
  })

  it('ignores a closed (data-state="closed") dialog — hotkey still fires', () => {
    const a = vi.fn()
    mountHotkeys({ a })
    const el = openDialog()
    el.setAttribute('data-state', 'closed')
    press('a')
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('still fires modifier combos while a dialog is open', () => {
    const submit = vi.fn()
    mountHotkeys({ 'mod+enter': submit })
    openDialog()
    press('Enter', { metaKey: true })
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('still fires Escape while a dialog is open', () => {
    const esc = vi.fn()
    mountHotkeys({ escape: esc })
    openDialog()
    press('Escape')
    expect(esc).toHaveBeenCalledTimes(1)
  })

  it('fires a single-key hotkey under a dialog when allowInModal is set', () => {
    const a = vi.fn()
    mountHotkeys({ a }, { allowInModal: true })
    openDialog()
    press('a')
    expect(a).toHaveBeenCalledTimes(1)
  })
})

describe('useHotkeys — enabled option (planning non-regression)', () => {
  it('does not fire when enabled is false', () => {
    const m = vi.fn()
    mountHotkeys({ m }, { enabled: false })
    press('m')
    expect(m).not.toHaveBeenCalled()
  })

  it('fires when enabled is true', () => {
    const m = vi.fn()
    mountHotkeys({ m }, { enabled: true })
    press('m')
    expect(m).toHaveBeenCalledTimes(1)
  })
})

describe('useHotkeys — active-field guard (existing behaviour)', () => {
  it('swallows single-key hotkeys typed inside an input', () => {
    const n = vi.fn()
    mountHotkeys({ n })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('n', {}, input)
    expect(n).not.toHaveBeenCalled()
  })

  it('still fires modifier combos typed inside an input', () => {
    const submit = vi.fn()
    mountHotkeys({ 'mod+enter': submit })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('Enter', { metaKey: true }, input)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
