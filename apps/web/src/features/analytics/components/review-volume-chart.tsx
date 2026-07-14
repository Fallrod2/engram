import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import type { ReviewVolumeBucket, ReviewVolumeResponse } from '@engram/shared'
import { RATINGS } from '@/features/review/labels'
import { useT, type TFunction } from '@/lib/i18n'
import { formatLongDay } from '@/lib/format'
import { chartInk, ratingColor } from '../chart-theme'
import { formatAxisDay } from '../metrics'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'
import { ChartLegend, type LegendItem } from './chart-legend'
import { ChartTableView, type ChartColumn } from './chart-table-view'
import { TooltipRow, TooltipShell } from './chart-tooltip'

const HEIGHT = 240

// Frozen stack order (bottom → top): the worst outcome sits at the base.
const SERIES = [
  { key: 'again', token: 'danger' },
  { key: 'hard', token: 'warning' },
  { key: 'good', token: 'success' },
  { key: 'easy', token: 'info' },
] as const

function buildTableColumns(t: TFunction): ChartColumn<ReviewVolumeBucket>[] {
  return [
    { key: 'date', header: t('analytics.colDay'), render: (b) => b.date, mono: true },
    {
      key: 'again',
      header: t('session.ratings.again'),
      align: 'right',
      mono: true,
      render: (b) => b.again,
    },
    {
      key: 'hard',
      header: t('session.ratings.hard'),
      align: 'right',
      mono: true,
      render: (b) => b.hard,
    },
    {
      key: 'good',
      header: t('session.ratings.good'),
      align: 'right',
      mono: true,
      render: (b) => b.good,
    },
    {
      key: 'easy',
      header: t('session.ratings.easy'),
      align: 'right',
      mono: true,
      render: (b) => b.easy,
    },
    {
      key: 'total',
      header: t('analytics.colTotal'),
      align: 'right',
      mono: true,
      render: (b) => b.total,
    },
  ]
}

export function ReviewVolumeChart({
  data,
  windowLabel,
  isFetching,
  error,
  onRetry,
  reduce,
}: {
  data: ReviewVolumeResponse | undefined
  windowLabel: string
  isFetching: boolean
  error: boolean
  onRetry: () => void
  reduce: boolean
}) {
  const t = useT()
  const tableColumns = buildTableColumns(t)
  // Legend labels reuse the shared rating i18n keys so they stay in sync with
  // the session (RATINGS[].label is an i18n key, resolved here).
  const legendItems: LegendItem[] = RATINGS.map((r) => ({
    colorVar: ratingColor[r.token],
    label: t(r.label),
  }))
  const buckets = data?.buckets ?? []
  const empty = data !== undefined && data.totals.total === 0
  // Selective direct label (spec §5): the total sits on the tallest column only,
  // never one number per bar.
  const maxTotalIndex = buckets.reduce(
    (best, b, i) => (b.total > (buckets[best]?.total ?? -1) ? i : best),
    0,
  )

  let body: React.ReactNode
  let table: React.ReactNode
  if (error && !data) {
    body = (
      <ChartEmpty
        variant="error"
        title={t('analytics.volumeError')}
        onRetry={onRetry}
        height={HEIGHT}
      />
    )
  } else if (empty) {
    body = (
      <ChartEmpty
        title={t('analytics.volumeEmpty')}
        hint={t('analytics.volumeHint')}
        height={HEIGHT}
      />
    )
  } else {
    body = (
      <>
        <ChartLegend items={legendItems} />
        <ResponsiveContainer width="100%" height={HEIGHT} className="mt-2">
          <BarChart
            accessibilityLayer
            data={buckets}
            margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
            barCategoryGap="15%"
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
              width={40}
              allowDecimals={false}
              tick={{ fill: chartInk.faint, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <Tooltip
              cursor={{ fill: chartInk.surface, opacity: 0.4 }}
              content={(props: TooltipProps<number, string>) => renderTooltip(props, t)}
              isAnimationActive={false}
            />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="v"
                fill={ratingColor[s.token]}
                stroke={chartInk.surface}
                strokeWidth={2}
                maxBarSize={24}
                isAnimationActive={!reduce}
                animationDuration={180}
                radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              >
                {/* Total label on the top segment of the tallest column only. */}
                {i === SERIES.length - 1 && (
                  <LabelList
                    dataKey="total"
                    content={<MaxTotalLabel targetIndex={maxTotalIndex} />}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </>
    )
    table = (
      <ChartTableView
        columns={tableColumns}
        rows={buckets}
        rowKey={(b) => b.date}
        caption={t('analytics.volumeCaption')}
      />
    )
  }

  return (
    <ChartCard
      title={t('analytics.volumeTitle')}
      subtitle={windowLabel}
      isFetching={isFetching}
      showToggle={!empty && !(error && !data)}
      table={table}
    >
      {body}
    </ChartCard>
  )
}

/**
 * Direct label rendered by Recharts on the tallest column's top segment only
 * (geometry injected via cloneElement). `viewBox` is the top segment's rect, so
 * its top edge is the top of the whole stack — the total sits just above it.
 */
function MaxTotalLabel(props: {
  x?: number
  y?: number
  width?: number
  index?: number
  value?: number
  targetIndex: number
}) {
  const { x, y, width, index, value, targetIndex } = props
  if (index !== targetIndex || x == null || y == null || width == null || value == null) return null
  return (
    <text
      x={x + width / 2}
      y={y - 6}
      textAnchor="middle"
      fill="var(--color-text)"
      fontSize={12}
      fontFamily="var(--font-mono)"
      className="tabular-nums"
    >
      {value}
    </text>
  )
}

function renderTooltip({ active, payload }: TooltipProps<number, string>, t: TFunction) {
  if (!active || !payload || payload.length === 0) return null
  const bucket = payload[0]?.payload as ReviewVolumeBucket | undefined
  if (!bucket) return null
  return (
    <TooltipShell date={formatLongDay(bucket.date)}>
      <TooltipRow
        colorVar={ratingColor.danger}
        label={t('session.ratings.again')}
        value={String(bucket.again)}
      />
      <TooltipRow
        colorVar={ratingColor.warning}
        label={t('session.ratings.hard')}
        value={String(bucket.hard)}
      />
      <TooltipRow
        colorVar={ratingColor.success}
        label={t('session.ratings.good')}
        value={String(bucket.good)}
      />
      <TooltipRow
        colorVar={ratingColor.info}
        label={t('session.ratings.easy')}
        value={String(bucket.easy)}
      />
      <TooltipRow
        colorVar={chartInk.axis}
        label={t('analytics.colTotal')}
        value={String(bucket.total)}
        strong
      />
    </TooltipShell>
  )
}
