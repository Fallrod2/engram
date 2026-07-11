import { createFileRoute } from '@tanstack/react-router'
import { CalendarDays, CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'

export const Route = createFileRoute('/planning')({
  component: PlanningPage,
})

function PlanningPage() {
  return (
    <EmptyState
      icon={CalendarDays}
      title="Aucune échéance planifiée."
      meta="0 examen · 0 review prévue"
      action={
        <Button variant="outline">
          <CalendarPlus className="size-4" />
          Ajouter un examen
        </Button>
      }
    />
  )
}
