import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Flame, Layers, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { dueCountsOptions } from '@/features/due-counts/queries'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const dueCounts = useQuery(dueCountsOptions())
  const totalDue = dueCounts.data?.total
  const hasDue = (totalDue ?? 0) > 0

  return (
    <div className="flex flex-col gap-6">
      {/* Quick stats — mono values, calm at zero (spec §3/§6). */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
            À réviser
          </p>
          <p className="mt-2 flex items-baseline gap-1.5">
            {totalDue === undefined ? (
              <Skeleton className="h-6 w-10" />
            ) : (
              <span className="font-mono text-2xl font-medium tabular-nums leading-none text-text">
                {totalDue}
              </span>
            )}
            <span className="text-xs text-text-faint">cartes</span>
          </p>
        </Card>
        {[
          { label: 'Série', value: '0', unit: 'jours' },
          { label: 'Étudié', value: '0', unit: 'min' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              {stat.label}
            </p>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-medium tabular-nums leading-none text-text">
                {stat.value}
              </span>
              <span className="text-xs text-text-faint">{stat.unit}</span>
            </p>
          </Card>
        ))}
      </section>

      {/* The most frequent empty state, treated as a reward (spec §6). */}
      <Card className="overflow-hidden">
        <EmptyState
          icon={Sparkles}
          title={
            hasDue
              ? `${totalDue} carte${totalDue === 1 ? '' : 's'} à réviser aujourd'hui.`
              : "Rien à réviser aujourd'hui — tout est à jour."
          }
          meta={hasDue ? `${totalDue} carte(s) due(s)` : '0 carte due · prochaine échéance —'}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild>
                <Link to="/subjects">
                  <Layers className="size-4" />
                  Créer une matière
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/planning">
                  <CalendarClock className="size-4" />
                  Voir le planning
                </Link>
              </Button>
            </div>
          }
        />
      </Card>

      <p className="flex items-center justify-center gap-1.5 text-xs text-text-faint">
        <Flame className="size-3.5" />
        Reviens chaque jour pour bâtir ta série.
      </p>
    </div>
  )
}
