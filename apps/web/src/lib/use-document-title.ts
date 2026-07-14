import { useEffect } from 'react'

/**
 * Sets `document.title` while the calling component is mounted and restores the
 * previous value on unmount. Used by the public auth screens (login / signup /
 * forgot / set-password), which render outside the app shell and would otherwise
 * inherit the long marketing title baked into the static index.html.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
