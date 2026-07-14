import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AdminStatsResponse } from '@engram/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useT, type TFunction } from '@/lib/i18n'
import { formatLongDay } from '@/lib/format'
import { cn } from '@/lib/utils'
import { chartInk } from '@/features/analytics/chart-theme'
import { formatAxisDay } from '@/features/analytics/metrics'
import { adminStatsOptions } from '../queries'

/** Provider → a stable themeable hue (the 8 subject tokens cover 7 providers + unknown). */
const PROVIDER_COLORS = [
  'var(--color-subject-1)',
  'var(--color-subject-2)',
  'var(--color-subject-3)',
  'var(--color-subject-4)',
  'var(--color-subject-5)',
  'var(--color-subject-6)',
  'var(--color-subject-7)',
  'var(--color-subject-8)',
]

export function AdminOverviewTab() {
  const t = useT()
  const statsQuery = useQuery(adminStatsOptions())

  if (statsQuery.isPending) return <OverviewSkeleton />
  if (statsQuery.isError || !statsQuery.data) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-text-muted">
        <span>{t('common.unavailable')}</span>
        <Button variant="outline" size="sm" onClick={() => void statsQuery.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  const s = statsQuery.data

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label={t('admin.overview.tileUsers')} value={s.totals.users} />
        <Tile label={t('admin.overview.tileActive')} value={s.totals.active7d} />
        <Tile
          label={t('admin.overview.tileSuspended')}
          value={s.totals.suspended}
          accent="danger"
        />
        <Tile label={t('admin.overview.tileAdmins')} value={s.totals.admins} />
        <Tile label={t('admin.overview.tileGenerations')} value={s.generations30d} />
        <Tile label={t('admin.overview.tileTokens')} value={s.tokens30d} />
        <Tile label={t('admin.overview.tileOcr')} value={s.ocrExtractions} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SignupsChart data={s} t={t} />
        <GenerationsChart data={s} t={t} />
      </div>
    </div>
  )
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: 'danger' }) {
  return (
    <div className="rounded-md border border-border bg-surface-1 p-3">
      <p className="text-2xs font-medium uppercase tracking-[0.06em] text-text-faint">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-2xl font-semibold tabular-nums tracking-[-0.02em]',
          accent === 'danger' && value > 0 ? 'text-danger' : 'text-text',
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function SignupsChart({ data, t }: { data: AdminStatsResponse; t: TFunction }) {
  const empty = data.signupsPerDay.every((d) => d.count === 0)
  return (
    <ChartCard title={t('admin.overview.signupsTitle')}>
      {empty ? (
        <ChartEmpty label={t('admin.overview.signupsEmpty')} />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            accessibilityLayer
            data={data.signupsPerDay}
            margin={{ top: 4, right: 8, bottom: 0, left: -12 }}
          >
            <CartesianGrid stroke={chartInk.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={{ stroke: chartInk.axis }}
              tick={{ fill: chartInk.faint, fontSize: 11 }}
              tickFormatter={formatAxisDay}
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
              tick={{ fill: chartInk.faint, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <Tooltip
              cursor={{ fill: chartInk.surface, opacity: 0.4 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0]?.payload as { date: string; count: number }
                return (
                  <TooltipShell date={formatLongDay(p.date)}>
                    <span className="text-text">{p.count}</span>
                  </TooltipShell>
                )
              }}
            />
            <Bar dataKey="count" fill="var(--color-accent)" maxBarSize={20} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

function GenerationsChart({ data, t }: { data: AdminStatsResponse; t: TFunction }) {
  // Union of providers present over the window, in a stable order.
  const providers = useMemo(() => {
    const set = new Set<string>()
    for (const d of data.generationsPerDay) for (const k of Object.keys(d.byProvider)) set.add(k)
    return [...set].sort()
  }, [data])

  // Flatten byProvider into top-level keys Recharts can stack.
  const rows = useMemo(
    () =>
      data.generationsPerDay.map((d) => {
        const row: Record<string, number | string> = { date: d.date }
        for (const p of providers) row[p] = d.byProvider[p] ?? 0
        return row
      }),
    [data, providers],
  )
  const empty = data.generationsPerDay.every((d) => d.total === 0)

  return (
    <ChartCard title={t('admin.overview.generationsTitle')}>
      {empty ? (
        <ChartEmpty label={t('admin.overview.generationsEmpty')} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {providers.map((p, i) => (
              <span key={p} className="flex items-center gap-1 text-2xs text-text-muted">
                <span
                  className="size-2 rounded-[2px]"
                  style={{ background: PROVIDER_COLORS[i % PROVIDER_COLORS.length] }}
                />
                {p}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              accessibilityLayer
              data={rows}
              margin={{ top: 4, right: 8, bottom: 0, left: -12 }}
            >
              <CartesianGrid stroke={chartInk.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: chartInk.axis }}
                tick={{ fill: chartInk.faint, fontSize: 11 }}
                tickFormatter={formatAxisDay}
                minTickGap={24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={32}
                allowDecimals={false}
                tick={{ fill: chartInk.faint, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              />
              <Tooltip
                cursor={{ fill: chartInk.surface, opacity: 0.4 }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const date = payload[0]?.payload?.date as string
                  return (
                    <TooltipShell date={formatLongDay(date)}>
                      {payload.map((entry) => (
                        <span key={entry.name} className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-[2px]"
                            style={{ background: entry.color }}
                          />
                          <span className="text-text-muted">{entry.name}</span>
                          <span className="ml-auto text-text">{entry.value}</span>
                        </span>
                      ))}
                    </TooltipShell>
                  )
                }}
              />
              {providers.map((p, i) => (
                <Bar
                  key={p}
                  dataKey={p}
                  stackId="g"
                  fill={PROVIDER_COLORS[i % PROVIDER_COLORS.length]}
                  maxBarSize={20}
                  radius={i === providers.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-surface-2 p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {children}
    </section>
  )
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-xs text-text-faint">
      {label}
    </div>
  )
}

function TooltipShell({ date, children }: { date: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-32 flex-col gap-1 rounded-md border border-border bg-surface-1 px-2.5 py-2 text-xs shadow-md">
      <span className="font-mono text-2xs text-text-faint">{date}</span>
      {children}
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-md" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-md" />
        <Skeleton className="h-64 rounded-md" />
      </div>
    </div>
  )
}
