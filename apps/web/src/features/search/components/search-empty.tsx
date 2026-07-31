import { Link } from '@tanstack/react-router'
import { Layers, Search as SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { CardsIllustration, SubjectsIllustration } from '@/components/illustrations'
import { usePlural, useT } from '@/lib/i18n'
import type { SearchEmptyKind } from '../results'

/**
 * The three ways this screen can have nothing to show — kept in ONE component
 * precisely because the bug they guard against is confusing them.
 *
 *  - `noCards`   — the account holds no card at all. It must NOT say "no
 *                  results": nothing failed to match, there is nothing to
 *                  match against, and the way out is to create or import.
 *  - `idle`      — nothing asked yet. An invitation with two real starting
 *                  points, and the corpus size so the screen proves it is
 *                  looking at something.
 *  - `noResults` — a real question, answered with none. The only one of the
 *                  three that offers to relax the query.
 */
export function SearchEmpty({
  kind,
  corpusSize,
  filtersActive,
  onResetFilters,
  onQuickFilter,
}: {
  kind: SearchEmptyKind
  corpusSize: number
  filtersActive: boolean
  onResetFilters: () => void
  onQuickFilter: (patch: { overdue?: true; state?: 'new' }) => void
}) {
  const t = useT()
  const plural = usePlural()

  if (kind === 'noCards') {
    return (
      <EmptyState
        illustration={<SubjectsIllustration />}
        title={t('search.empty.noCardsTitle')}
        meta={t('search.empty.noCardsMeta')}
        action={
          <Button asChild>
            <Link to="/subjects">
              <Layers />
              {t('search.empty.noCardsAction')}
            </Link>
          </Button>
        }
      />
    )
  }

  if (kind === 'idle') {
    return (
      <EmptyState
        icon={SearchIcon}
        title={t('search.empty.idleTitle')}
        meta={t(`search.empty.idleMeta_${plural(corpusSize)}`, { count: corpusSize })}
        action={
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-sm text-sm text-text-muted">{t('search.empty.idleHint')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onQuickFilter({ overdue: true })}
              >
                {t('search.quick.overdue')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onQuickFilter({ state: 'new' })}>
                {t('search.quick.newCards')}
              </Button>
            </div>
          </div>
        }
      />
    )
  }

  return (
    <EmptyState
      illustration={<CardsIllustration />}
      title={t('search.empty.noResultsTitle')}
      meta={t('search.empty.noResultsMeta')}
      {...(filtersActive
        ? {
            action: (
              <Button variant="secondary" onClick={onResetFilters}>
                {t('search.filters.clear')}
              </Button>
            ),
          }
        : {})}
    />
  )
}
