import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  adminAuditResponseSchema,
  adminDeleteUserResponseSchema,
  adminGroupSchema,
  adminGroupMembersResponseSchema,
  adminGroupsResponseSchema,
  adminStatsResponseSchema,
  adminUserDetailSchema,
  adminUsersResponseSchema,
  adminUserSummarySchema,
  meResponseSchema,
  type AdminPermission,
  type AdminUsersQuery,
  type UserRole,
  type UserStatus,
} from '@engram/shared'
import { api, qs } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { useT } from '@/lib/i18n'

/**
 * IAM/admin data layer. `meQuery` (the identity probe) is the pivot: the `/admin`
 * route guard and the conditional sidebar entry both read it from ONE shared
 * cache (amendment A12), so the nav never flashes and the guard never double-hits.
 * Every mutation just surfaces the server's decision — the server is the sole
 * authority — and a guard rejection (403) becomes a clear toast.
 */

const ME_STALE = 60_000 // ≥30s: the nav must not spam /api/me (amendment A12).

export function meQuery() {
  return queryOptions({
    queryKey: qk.me,
    queryFn: ({ signal }) => api.get('/me', meResponseSchema, signal),
    staleTime: ME_STALE,
  })
}

export function adminUsersOptions(params: AdminUsersQuery) {
  return queryOptions({
    queryKey: qk.admin.users({
      query: params.query,
      page: params.page,
      sort: params.sort,
      dir: params.dir,
    }),
    queryFn: ({ signal }) =>
      api.get(`/admin/users${qs({ ...params })}`, adminUsersResponseSchema, signal),
  })
}

export function adminUserDetailOptions(userId: string) {
  return queryOptions({
    queryKey: qk.admin.userDetail(userId),
    queryFn: ({ signal }) => api.get(`/admin/users/${userId}`, adminUserDetailSchema, signal),
  })
}

export function adminStatsOptions() {
  return queryOptions({
    queryKey: qk.admin.stats,
    queryFn: ({ signal }) => api.get('/admin/stats', adminStatsResponseSchema, signal),
    staleTime: 60_000,
  })
}

export function adminAuditOptions(page: number) {
  return queryOptions({
    queryKey: qk.admin.audit(page),
    queryFn: ({ signal }) =>
      api.get(`/admin/audit${qs({ page })}`, adminAuditResponseSchema, signal),
  })
}

/** Shared write scaffold: invalidate the whole admin surface + surface guard errors. */
function useAdminMutation<Vars>(mutationFn: (vars: Vars) => Promise<unknown>) {
  const qc = useQueryClient()
  const t = useT()
  return useMutation({
    mutationFn,
    onError: (err: Error) => {
      // Server guards (last admin, self-action, admin-demo…) → a clear toast.
      toast.error(t('admin.toasts.actionFailed'), { description: err.message })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.all })
      void qc.invalidateQueries({ queryKey: qk.me })
    },
  })
}

export function useSetRole() {
  return useAdminMutation<{ userId: string; role: UserRole }>(({ userId, role }) =>
    api.patch(`/admin/users/${userId}/role`, { role }, adminUserSummarySchema),
  )
}

export function useSetStatus() {
  return useAdminMutation<{ userId: string; status: UserStatus }>(({ userId, status }) =>
    api.patch(`/admin/users/${userId}/status`, { status }, adminUserSummarySchema),
  )
}

export function useSetDemo() {
  return useAdminMutation<{ userId: string; isDemo: boolean }>(({ userId, isDemo }) =>
    api.patch(`/admin/users/${userId}/demo`, { isDemo }, adminUserSummarySchema),
  )
}

export function useDeleteUser() {
  const qc = useQueryClient()
  const t = useT()
  return useMutation({
    mutationFn: (userId: string) =>
      api.deleteWith(`/admin/users/${userId}`, adminDeleteUserResponseSchema),
    onError: (err: Error) => {
      toast.error(t('admin.toasts.deleteFailed'), { description: err.message })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.all })
    },
  })
}

// --- Groups (delegated administration, rbac-groups §5) ---------------------

export function adminGroupsOptions() {
  return queryOptions({
    queryKey: qk.admin.groups,
    queryFn: ({ signal }) => api.get('/admin/groups', adminGroupsResponseSchema, signal),
  })
}

export function adminGroupMembersOptions(groupId: string) {
  return queryOptions({
    queryKey: qk.admin.groupMembers(groupId),
    queryFn: ({ signal }) =>
      api.get(`/admin/groups/${groupId}/members`, adminGroupMembersResponseSchema, signal),
  })
}

/**
 * Shared group-write scaffold: invalidate the whole admin surface (group list,
 * the user list's chips) + `/api/me` (a membership change may alter the caller's
 * OWN effective permissions) and surface a guard rejection (403) as a toast.
 */
function useGroupMutation<Vars>(mutationFn: (vars: Vars) => Promise<unknown>) {
  const qc = useQueryClient()
  const t = useT()
  return useMutation({
    mutationFn,
    onError: (err: Error) => {
      toast.error(t('admin.toasts.actionFailed'), { description: err.message })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.all })
      void qc.invalidateQueries({ queryKey: qk.me })
    },
  })
}

export function useCreateGroup() {
  return useGroupMutation<{ name: string; description?: string }>((body) =>
    api.post('/admin/groups', body, adminGroupSchema),
  )
}

export function useUpdateGroup() {
  return useGroupMutation<{ id: string; name?: string; description?: string | null }>(
    ({ id, ...body }) => api.patch(`/admin/groups/${id}`, body, adminGroupSchema),
  )
}

export function useDeleteGroup() {
  return useGroupMutation<{ id: string }>(({ id }) => api.delete(`/admin/groups/${id}`))
}

export function useSetGroupPermissions() {
  return useGroupMutation<{ id: string; permissions: AdminPermission[] }>(({ id, permissions }) =>
    api.putWith(`/admin/groups/${id}/permissions`, { permissions }, adminGroupSchema),
  )
}

export function useAddMember() {
  return useGroupMutation<{ groupId: string; userId: string }>(({ groupId, userId }) =>
    api.post(`/admin/groups/${groupId}/members`, { userId }, adminGroupMembersResponseSchema),
  )
}

export function useRemoveMember() {
  return useGroupMutation<{ groupId: string; userId: string }>(({ groupId, userId }) =>
    api.deleteWith(
      `/admin/groups/${groupId}/members/${encodeURIComponent(userId)}`,
      adminGroupMembersResponseSchema,
    ),
  )
}
