import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ShieldCheck } from 'lucide-react'
import type { MeResponse } from '@engram/shared'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'
import { meQuery } from '@/features/admin/queries'
import { AdminUsersTab } from '@/features/admin/components/users-tab'
import { AdminGroupsTab } from '@/features/admin/components/groups-tab'
import { AdminOverviewTab } from '@/features/admin/components/overview-tab'
import { AdminAuditTab } from '@/features/admin/components/audit-tab'

const adminSearchSchema = z.object({
  tab: z.enum(['users', 'groups', 'overview', 'audit']).catch('users'),
})
type AdminTab = z.infer<typeof adminSearchSchema>['tab']

/**
 * Does the caller have access to any of the admin console (rbac-groups §5,
 * amendment G1)? An admin always; a delegate iff they hold at least one
 * permission. The SAME predicate backs the guard and the sidebar entry.
 */
export function hasAdminAccess(me: Pick<MeResponse, 'isAdmin' | 'permissions'>): boolean {
  return me.isAdmin || me.permissions.length > 0
}

/** Per-tab permission mirror of the server guards (the server stays authority). */
function tabAccess(me: Pick<MeResponse, 'isAdmin' | 'permissions'>) {
  const can = (p: string) => me.isAdmin || me.permissions.includes(p)
  return {
    users: can('users.view'),
    groups: can('groups.manage'),
    overview: can('stats.view'),
    audit: can('audit.view'),
  }
}

export const Route = createFileRoute('/admin')({
  validateSearch: adminSearchSchema,
  // The SERVER is the sole authority (every /api/admin/* route re-checks). This
  // guard is a convenience that avoids rendering the console for someone with no
  // access. It blocks on the SHARED /api/me cache (amendment A12 — no admin-UI
  // flash) and bounces to '/' on no-access OR any failure (a 403 suspended too).
  beforeLoad: async ({ context }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery())
      if (!hasAdminAccess(me)) throw redirect({ to: '/' })
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
  const me = useQuery(meQuery()).data

  const access = me ? tabAccess(me) : { users: false, groups: false, overview: false, audit: false }
  // The visible tab list, in order. Falls back to the first accessible tab when
  // the URL asks for one the delegate cannot see (mirrors the server).
  const visible = (['users', 'groups', 'overview', 'audit'] as const).filter((k) => access[k])
  const current: AdminTab = access[tab] ? tab : (visible[0] ?? 'users')

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
        value={current}
        onValueChange={(v) => void navigate({ search: { tab: v as AdminTab }, replace: true })}
      >
        <TabsList>
          {access.users && <TabsTrigger value="users">{t('admin.tabs.users')}</TabsTrigger>}
          {access.groups && <TabsTrigger value="groups">{t('admin.tabs.groups')}</TabsTrigger>}
          {access.overview && (
            <TabsTrigger value="overview">{t('admin.tabs.overview')}</TabsTrigger>
          )}
          {access.audit && <TabsTrigger value="audit">{t('admin.tabs.audit')}</TabsTrigger>}
        </TabsList>
        {access.users && (
          <TabsContent value="users" className="mt-5">
            <AdminUsersTab />
          </TabsContent>
        )}
        {access.groups && (
          <TabsContent value="groups" className="mt-5">
            <AdminGroupsTab />
          </TabsContent>
        )}
        {access.overview && (
          <TabsContent value="overview" className="mt-5">
            <AdminOverviewTab />
          </TabsContent>
        )}
        {access.audit && (
          <TabsContent value="audit" className="mt-5">
            <AdminAuditTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
