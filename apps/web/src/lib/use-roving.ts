import { useCallback, useEffect, useRef, useState } from 'react'
import { isEditableTarget } from './use-hotkeys'

/**
 * Roving tabindex for dense lists/tables (spec §1.7). One item is `tabindex=0`
 * (the cursor); the rest are `-1`. `↑/↓` and `j/k` move the cursor, `Home/End`
 * jump to bounds, `Enter` activates. Focus stays visible via the global indigo
 * double-ring. The cursor row also gets `data-active` for the accent edge bar.
 */
export function useRovingList<T extends HTMLElement = HTMLElement>(
  count: number,
  onActivate?: (index: number) => void,
) {
  const [active, setActive] = useState(0)
  const refs = useRef<(T | null)[]>([])
  const activeRef = useRef(0)
  activeRef.current = active

  // Keep the cursor in range as the list shrinks/grows.
  useEffect(() => {
    if (active > count - 1) setActive(Math.max(0, count - 1))
  }, [count, active])

  const focusIndex = useCallback((i: number) => {
    setActive(i)
    refs.current[i]?.focus()
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return
      const k = e.key
      const single = k === 'j' || k === 'k'
      if (single && isEditableTarget(e.target)) return
      let next: number | null = null
      if (k === 'ArrowDown' || k === 'j') next = Math.min(count - 1, activeRef.current + 1)
      else if (k === 'ArrowUp' || k === 'k') next = Math.max(0, activeRef.current - 1)
      else if (k === 'Home') next = 0
      else if (k === 'End') next = count - 1
      else if (k === 'Enter') {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onActivate?.(activeRef.current)
        return
      }
      if (next === null) return
      e.preventDefault()
      focusIndex(next)
    },
    [count, focusIndex, onActivate],
  )

  const getItemProps = useCallback(
    (index: number) => ({
      ref: (el: T | null) => {
        refs.current[index] = el
      },
      tabIndex: index === active ? 0 : -1,
      'data-active': index === active ? '' : undefined,
      onFocus: () => setActive(index),
    }),
    [active],
  )

  return { active, setActive, focusIndex, onKeyDown, getItemProps }
}
