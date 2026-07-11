import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarClock, Flame, Layers, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

interface Stat {
  label: string
  value: string
  unit?: string
}

const STATS: Stat[] = [
  { label: 'À réviser', value: '0', unit: 'cartes' },
  { label: 'Série', value: '0', unit: 'jours' },
  { label: 'Étudié', value: '0', unit: 'min' },
]

function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* Quick stats — mono values, calm at zero (spec §3/§6). */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STATS.map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
              {stat.label}
            </p>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl font-medium tabular-nums leading-none text-text">
                {stat.value}
              </span>
              {stat.unit && <span className="text-xs text-text-faint">{stat.unit}</span>}
            </p>
          </Card>
        ))}
      </section>

      {/* The most frequent empty state, treated as a reward (spec §6). */}
      <Card className="overflow-hidden">
        <EmptyState
          icon={Sparkles}
          title="Rien à réviser aujourd'hui — tout est à jour."
          meta="0 carte due · prochaine échéance —"
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
