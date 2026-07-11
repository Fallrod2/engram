import { createRootRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/shell/app-shell'

export const Route = createRootRoute({
  component: AppShell,
})
