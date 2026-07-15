import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react'
import type { AdminAuditAction, AdminAuditEntry } from '@engram/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useT, type TFunction, type TKey } from '@/lib/i18n'
import { formatRelativeTime } from '@/lib/format'
import { adminAuditOptions } from '../queries'

const ACTION_KEY: Record<AdminAuditAction, TKey> = {
  'role.promote': 'admin.audit.actions.rolePromote',
  'role.demote': 'admin.audit.actions.roleDemote',
  'status.suspend': 'admin.audit.actions.statusSuspend',
  'status.reactivate': 'admin.audit.actions.statusReactivate',
  'demo.set': 'admin.audit.actions.demoSet',
  'demo.unset': 'admin.audit.actions.demoUnset',
  'user.delete': 'admin.audit.actions.userDelete',
  'group.create': 'admin.audit.actions.groupCreate',
  'group.update': 'admin.audit.actions.groupUpdate',
  'group.delete': 'admin.audit.actions.groupDelete',
  'group.permissions': 'admin.audit.actions.groupPermissions',
  'group.member.add': 'admin.audit.actions.groupMemberAdd',
  'group.member.remove': 'admin.audit.actions.groupMemberRemove',
}

export function AdminAuditTab() {
  const t = useT()
  const [page, setPage] = useState(1)
  const auditQuery = useQuery({ ...adminAuditOptions(page), placeholderData: keepPreviousData })

  if (auditQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    )
  }
  const data = auditQuery.data
  if (!data || data.entries.length === 0) {
    return <EmptyState icon={ScrollText} title={t('admin.audit.empty')} />
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-faint">{t('admin.audit.subtitle')}</p>
      <ul className="flex flex-col gap-2">
        {data.entries.map((e) => (
          <AuditRow key={e.id} entry={e} t={t} />
        ))}
      </ul>
      {data.totalPages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-text-muted">
          <Button
            variant="outline"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">
            {t('admin.users.pageLabel', { page: data.page, total: data.totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function AuditRow({ entry, t }: { entry: AdminAuditEntry; t: TFunction }) {
  const [open, setOpen] = useState(false)
  // The audit journal outlives the accounts it references (GDPR delete keeps the
  // row); once a profile is gone its email no longer resolves, so fall back to a
  // localized "deleted account" label rather than a raw id.
  const actor = entry.actorEmail ?? t('admin.audit.unknownUser')
  const target = entry.targetEmail ?? (entry.targetUserId ? t('admin.audit.unknownUser') : null)
  const hasDetails = Object.keys(entry.details).length > 0

  return (
    <li className="rounded-md border border-border bg-surface-1 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
        <span className="font-medium text-text">{actor}</span>
        <span className="text-text-muted">{t(ACTION_KEY[entry.action])}</span>
        {target && <span className="font-medium text-text">{target}</span>}
        <span className="ml-auto whitespace-nowrap text-2xs text-text-faint">
          {formatRelativeTime(entry.createdAt)}
        </span>
      </div>
      {hasDetails && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="mt-1 text-2xs text-text-faint hover:text-text-muted">
            {t('admin.audit.detailsToggle', { sign: open ? '−' : '+' })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 overflow-x-auto rounded-sm bg-surface-2 p-2 font-mono text-2xs text-text-muted">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  )
}
