import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import type { RetentionResponse, Subject } from '@engram/shared'
import { SubjectDot } from '@/components/subject-dot'
import { chartInk, subjectColorValue } from '../chart-theme'
import { formatPercent } from '../metrics'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'
import { ChartTableView, type ChartColumn } from './chart-table-view'
import { TooltipRow, TooltipShell } from './chart-tooltip'

const Y_WIDTH = 152
const ROW_H = 34

interface Row {
  subjectId: string
  name: string
  color: string
  retention: number | null
  reviews: number
}

const tableColumns: ChartColumn<Row>[] = [
  { key: 'name', header: 'Matière', render: (r) => r.name },
  { key: 'reviews', header: 'Reviews mûres', align: 'right', mono: true, render: (r) => r.reviews },
  {
    key: 'retention',
    header: 'Rétention',
    align: 'right',
    mono: true,
    render: (r) => (r.retention === null ? '—' : formatPercent(r.retention)),
  },
]

export function RetentionBySubjectChart({
  data,
  subjects,
  windowLabel,
  isFetching,
  error,
  onRetry,
}: {
  data: RetentionResponse | undefined
  subjects: Subject[]
  windowLabel: string
  isFetching: boolean
  error: boolean
  onRetry: () => void
}) {
  const byId = new Map(subjects.map((s) => [s.id, s]))
  const rows: Row[] = (data?.subjects ?? []).flatMap((r) => {
    const s = byId.get(r.subjectId)
    if (!s) return []
    return [
      {
        subjectId: r.subjectId,
        name: s.name,
        color: s.color,
        retention: r.retention,
        reviews: r.maturedReviewed,
      },
    ]
  })

  const rated = rows.filter((r) => r.retention !== null).sort((a, b) => b.retention! - a.retention!)
  const unrated = rows
    .filter((r) => r.retention === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const allEmpty = data !== undefined && rated.length === 0
  const colorById = new Map(rows.map((r) => [r.subjectId, r.color]))

  let body: React.ReactNode
  let table: React.ReactNode
  if (error && !data) {
    body = (
      <ChartEmpty
        variant="error"
        title="Impossible de charger la rétention."
        onRetry={onRetry}
        height={180}
      />
    )
  } else if (allEmpty) {
    body = (
      <ChartEmpty
        title="Révise encore un peu pour voir ta rétention par matière."
        hint="La rétention se calcule sur les cartes mûres (≥ 10 reviews)."
        height={180}
      />
    )
  } else {
    body = (
      <div>
        <ResponsiveContainer width="100%" height={rated.length * ROW_H + 28}>
          <BarChart
            accessibilityLayer
            data={rated}
            layout="vertical"
            margin={{ top: 0, right: 44, bottom: 4, left: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid stroke={chartInk.grid} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 1]}
              ticks={[0, 0.5, 1]}
              tickLine={false}
              axisLine={{ stroke: chartInk.axis }}
              tick={{ fill: chartInk.faint, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              tickFormatter={(v: number) => String(Math.round(v * 100))}
            />
            <YAxis
              type="category"
              dataKey="subjectId"
              width={Y_WIDTH}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={<SubjectTick lookup={rows} />}
            />
            <Tooltip
              cursor={{ fill: chartInk.surface, opacity: 0.4 }}
              content={renderTooltip}
              isAnimationActive={false}
            />
            <Bar
              dataKey="retention"
              maxBarSize={24}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              {rated.map((r) => (
                <Cell
                  key={r.subjectId}
                  fill={subjectColorValue(colorById.get(r.subjectId) ?? r.color)}
                />
              ))}
              <LabelList
                dataKey="retention"
                position="right"
                formatter={(v: number) => formatPercent(v)}
                fill="var(--color-text)"
                fontSize={12}
                fontFamily="var(--font-mono)"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {unrated.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
            {unrated.map((r) => (
              <li key={r.subjectId} className="flex items-center gap-2 opacity-70">
                <SubjectDot color={r.color} />
                <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{r.name}</span>
                <span className="font-mono text-xs text-text-faint">—</span>
                <span className="text-xs text-text-faint">pas encore assez de données</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
    table = (
      <ChartTableView
        columns={tableColumns}
        rows={[...rated, ...unrated]}
        rowKey={(r) => r.subjectId}
        caption="Rétention par matière"
      />
    )
  }

  return (
    <ChartCard
      title="Rétention par matière"
      subtitle={windowLabel}
      isFetching={isFetching}
      showToggle={!allEmpty && !(error && !data)}
      table={table}
    >
      {body}
    </ChartCard>
  )
}

/** Custom Y tick: SubjectDot color + name, so identity is carried off-color. */
function SubjectTick(props: {
  x?: number
  y?: number
  payload?: { value?: string }
  lookup: Row[]
}) {
  const { x = 0, y = 0, payload, lookup } = props
  const row = lookup.find((r) => r.subjectId === payload?.value)
  if (!row) return null
  const name = row.name.length > 20 ? `${row.name.slice(0, 19)}…` : row.name
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={-Y_WIDTH + 6} cy={0} r={4} fill={subjectColorValue(row.color)} />
      <text
        x={-Y_WIDTH + 18}
        y={0}
        dy="0.32em"
        textAnchor="start"
        fill="var(--color-text)"
        fontSize={13}
        fontFamily="var(--font-sans)"
      >
        {name}
      </text>
    </g>
  )
}

function renderTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload as Row | undefined
  if (!row || row.retention === null) return null
  return (
    <TooltipShell
      date={`${row.reviews} review${row.reviews > 1 ? 's' : ''} mûre${row.reviews > 1 ? 's' : ''}`}
    >
      <TooltipRow
        colorVar={subjectColorValue(row.color)}
        label={row.name}
        value={formatPercent(row.retention)}
        strong
      />
    </TooltipShell>
  )
}
