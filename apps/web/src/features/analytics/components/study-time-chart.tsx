import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import type { StudyTimeBucket, StudyTimeResponse } from '@engram/shared'
import { formatLongDay } from '@/lib/format'
import { accentSeries, chartInk } from '../chart-theme'
import { formatAxisDay, formatDuration, formatDurationAxis } from '../metrics'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'
import { ChartTableView, type ChartColumn } from './chart-table-view'
import { TooltipRow, TooltipShell } from './chart-tooltip'

const HEIGHT = 240

const tableColumns: ChartColumn<StudyTimeBucket>[] = [
  { key: 'date', header: 'Jour', render: (b) => b.date, mono: true },
  {
    key: 'ms',
    header: 'Durée',
    align: 'right',
    mono: true,
    render: (b) => formatDuration(b.durationMs),
  },
  { key: 'reviews', header: 'Reviews', align: 'right', mono: true, render: (b) => b.reviewCount },
  {
    key: 'measured',
    header: 'Mesurées',
    align: 'right',
    mono: true,
    render: (b) => b.measuredCount,
  },
]

export function StudyTimeChart({
  data,
  windowLabel,
  isFetching,
  error,
  onRetry,
  reduce,
}: {
  data: StudyTimeResponse | undefined
  windowLabel: string
  isFetching: boolean
  error: boolean
  onRetry: () => void
  reduce: boolean
}) {
  const buckets = data?.buckets ?? []
  const empty = data !== undefined && data.totalMs === 0

  let body: React.ReactNode
  let table: React.ReactNode
  if (error && !data) {
    body = (
      <ChartEmpty
        variant="error"
        title="Impossible de charger le temps d'étude."
        onRetry={onRetry}
        height={HEIGHT}
      />
    )
  } else if (empty) {
    body = (
      <ChartEmpty
        title="Pas de temps d'étude mesuré sur cette période."
        hint="Les durées se mesurent pendant les sessions."
        height={HEIGHT}
      />
    )
  } else {
    body = (
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <AreaChart data={buckets} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
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
            width={48}
            tick={{ fill: chartInk.faint, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            tickFormatter={(ms: number) => formatDurationAxis(ms)}
          />
          <Tooltip
            cursor={{ stroke: chartInk.axis, strokeWidth: 1 }}
            content={renderTooltip}
            isAnimationActive={false}
          />
          <Area
            dataKey="durationMs"
            type="monotone"
            stroke={accentSeries.line}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={accentSeries.wash}
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, stroke: chartInk.surface, strokeWidth: 2, fill: accentSeries.line }}
            isAnimationActive={!reduce}
            animationDuration={180}
          />
        </AreaChart>
      </ResponsiveContainer>
    )
    table = (
      <ChartTableView
        columns={tableColumns}
        rows={buckets}
        rowKey={(b) => b.date}
        caption="Temps d'étude par jour"
      />
    )
  }

  return (
    <ChartCard
      title="Temps d'étude"
      subtitle={windowLabel}
      isFetching={isFetching}
      showToggle={!empty && !(error && !data)}
      table={table}
    >
      {body}
    </ChartCard>
  )
}

function renderTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const bucket = payload[0]?.payload as StudyTimeBucket | undefined
  if (!bucket) return null
  return (
    <TooltipShell date={formatLongDay(bucket.date)}>
      <TooltipRow
        colorVar={accentSeries.line}
        label="Temps d'étude"
        value={formatDuration(bucket.durationMs)}
        strong
      />
    </TooltipShell>
  )
}
