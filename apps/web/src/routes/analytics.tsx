import { createFileRoute, Link } from '@tanstack/react-router'
import { ChartColumn, GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  return (
    <EmptyState
      icon={ChartColumn}
      title="Pas encore de données à analyser."
      meta="0 review enregistrée"
      action={
        <Button asChild variant="outline">
          <Link to="/review">
            <GraduationCap className="size-4" />
            Lancer une session
          </Link>
        </Button>
      }
    />
  )
}
