import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
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
import { LowDataNote } from './low-data-note'

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
  // A filled area needs at least two measured days to read as a trend; with one
  // (or zero) the fill implies a slope the data doesn't support (spec §7). Below
  // the floor we drop stroke+fill and plot the bare measured point(s) + a note.
  const measuredPoints = buckets.filter((b) => b.measuredCount > 0).length
  const lowData = measuredPoints < 2
  const lastIndex = buckets.length - 1
  const lastMeasured = buckets.at(-1)

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
      <div>
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <AreaChart
            accessibilityLayer
            data={buckets}
            // Extra right margin so the end-anchored value label on the LAST point
            // is not clipped by the plot edge (finding: label truncated on the
            // right). The last data point sits at `plotWidth`, and the label is
            // textAnchor="end", i.e. it extends leftward from that x — the margin
            // gives the last glyph room to breathe.
            margin={{ top: 8, right: 40, bottom: 0, left: -4 }}
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
              stroke={lowData ? 'none' : accentSeries.line}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill={accentSeries.wash}
              fillOpacity={lowData ? 0 : 0.1}
              dot={lowData ? <MeasuredDot /> : false}
              activeDot={{
                r: 4,
                stroke: chartInk.surface,
                strokeWidth: 2,
                fill: accentSeries.line,
              }}
              isAnimationActive={!reduce}
              animationDuration={180}
            >
              {/* Direct label — selective (spec §7): the value at the last point only. */}
              {!lowData && lastMeasured && (
                <LabelList
                  dataKey="durationMs"
                  content={<LastPointLabel targetIndex={lastIndex} />}
                />
              )}
            </Area>
          </AreaChart>
        </ResponsiveContainer>
        {lowData && (
          <LowDataNote>Trop peu de jours mesurés pour tracer une tendance fiable.</LowDataNote>
        )}
      </div>
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

/**
 * Direct label rendered by Recharts at the last point only (geometry injected via
 * cloneElement). Shows the study duration in mono `text-muted` (spec §7).
 */
function LastPointLabel(props: {
  x?: number
  y?: number
  index?: number
  value?: number
  targetIndex: number
}) {
  const { x, y, index, value, targetIndex } = props
  if (index !== targetIndex || x == null || y == null || value == null) return null
  return (
    <text
      x={x}
      y={y - 10}
      textAnchor="end"
      fill="var(--color-text-muted)"
      fontSize={11}
      fontFamily="var(--font-mono)"
      className="tabular-nums"
    >
      {formatDuration(value)}
    </text>
  )
}

/** Low-data dot: renders a ringed dot only for days that carry a measured duration. */
function MeasuredDot(props: { cx?: number; cy?: number; payload?: StudyTimeBucket }) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload || payload.measuredCount === 0) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={accentSeries.line}
      stroke={chartInk.surface}
      strokeWidth={2}
    />
  )
}
