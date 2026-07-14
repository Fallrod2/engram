import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'
import { meQuery } from '@/features/admin/queries'
import { AdminUsersTab } from '@/features/admin/components/users-tab'
import { AdminOverviewTab } from '@/features/admin/components/overview-tab'
import { AdminAuditTab } from '@/features/admin/components/audit-tab'

const adminSearchSchema = z.object({
  tab: z.enum(['users', 'overview', 'audit']).catch('users'),
})

export const Route = createFileRoute('/admin')({
  validateSearch: adminSearchSchema,
  // The SERVER is the sole authority (every /api/admin/* route re-checks). This
  // guard is a convenience that avoids rendering the console for a non-admin. It
  // blocks on the SHARED /api/me cache (amendment A12 — no admin-UI flash) and
  // bounces to '/' on non-admin OR any failure (a 403 suspended included).
  beforeLoad: async ({ context }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery())
      if (!me.isAdmin) throw redirect({ to: '/' })
    } catch (err) {
      if (err && typeof err === 'object' && 'to' in err) throw err // a redirect
      throw redirect({ to: '/' })
    }
  },
  component: AdminPage,
})

function AdminPage() {
  const t = useT()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="flex flex-col">
      <PageHeader
        title={
          <>
            <ShieldCheck className="size-5 text-accent" />
            {t('admin.title')}
          </>
        }
      />
      <p className="-mt-4 mb-5 text-sm text-text-muted">{t('admin.subtitle')}</p>

      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ search: { tab: v as typeof tab }, replace: true })}
      >
        <TabsList>
          <TabsTrigger value="users">{t('admin.tabs.users')}</TabsTrigger>
          <TabsTrigger value="overview">{t('admin.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="audit">{t('admin.tabs.audit')}</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-5">
          <AdminUsersTab />
        </TabsContent>
        <TabsContent value="overview" className="mt-5">
          <AdminOverviewTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-5">
          <AdminAuditTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
