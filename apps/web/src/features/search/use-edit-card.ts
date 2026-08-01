import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Card, CardSearchHit } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { cardDetailOptions } from './queries'

/**
 * Which card `?edit=<id>` refers to — and what to say when we cannot find out.
 *
 * A ⌘K hand-off can name a card that is not on the page currently fetched: same
 * needle, but the row may sit at offset 40. So the id is fetched on its own when
 * the local `known` map does not hold it.
 *
 * T-067 — that by-id read had no failure path. `editFallback.data ?? null` made
 * a failed request indistinguishable from "no such card", the dialog's `open`
 * condition stayed false, and the screen did NOTHING after the user had picked
 * something — the exact outcome the comment above the fetch said it existed to
 * prevent. It is now said out loud, with a retry that re-runs the request.
 *
 * `?edit=` is deliberately LEFT in the URL on failure. It is what keeps the
 * query enabled, so the retry has something to retry and a successful one opens
 * the dialog; clearing it would turn "we could not open this" into "you asked
 * for nothing" — the same silence, moved.
 */
export function useEditCard(
  editId: string | undefined,
  known: Map<string, CardSearchHit>,
): { card: Card | null; failed: boolean; retry: () => void } {
  const t = useT()
  const hit = editId ? known.get(editId) : undefined
  const fallback = useQuery({
    ...cardDetailOptions(editId ?? ''),
    enabled: editId !== undefined && hit === undefined,
  })
  const retry = () => void fallback.refetch()

  // One toast per FAILURE, not per render: the query holds its error state, and
  // effects re-run on every dependency change. `errorUpdatedAt` moves on each
  // new error, so a retry that fails again is announced again — which it must
  // be, or the second attempt is as silent as the bug being fixed here.
  const announced = useRef(0)
  useEffect(() => {
    if (editId === undefined || !fallback.isError) return
    if (fallback.errorUpdatedAt === announced.current) return
    announced.current = fallback.errorUpdatedAt
    toast.error(t('search.editError'), {
      action: { label: t('common.retry'), onClick: () => void fallback.refetch() },
    })
  }, [editId, fallback, t])

  return {
    card: hit?.card ?? (editId ? (fallback.data ?? null) : null),
    failed: fallback.isError,
    retry,
  }
}
