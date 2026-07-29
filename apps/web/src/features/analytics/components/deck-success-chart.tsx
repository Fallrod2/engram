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
import type { Deck, DeckSuccessResponse, Subject } from '@engram/shared'
import { useT, usePlural, type PluralCategory, type TFunction } from '@/lib/i18n'
import { chartInk, subjectColorValue } from '../chart-theme'
import { formatPercent } from '../metrics'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'
import { ChartTableView } from './chart-table-view'
import { TooltipRow, TooltipShell } from './chart-tooltip'

/**
 * Success rate per deck, INSIDE one subject — the drill-down of the deck list
 * the Subject screen already shows, and the reason this chart lives here and not
 * on the Analytics screen: across every subject at once, a ranking of deck names
 * compares things that have nothing to do with each other.
 *
 * One series, one hue (the subject's own pigment) — so no legend, per the
 * dataviz rule; identity comes from the deck names on the axis and the direct
 * labels. A deck under the server's `minSample` keeps its row with a dash rather
 * than a percentage computed from four reviews.
 */

const Y_WIDTH = 148
const ROW_H = 34

interface Row {
  deckId: string
  name: string
  successRate: number | null
  reviewed: number
}

export function DeckSuccessChart({
  data,
  decks,
  subject,
  windowLabel,
  isFetching,
  error,
  onRetry,
}: {
  data: DeckSuccessResponse | undefined
  decks: Deck[]
  subject: Subject
  windowLabel: string
  isFetching: boolean
  error: boolean
  onRetry: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const byId = new Map(decks.map((d) => [d.id, d]))
  const rows: Row[] = (data?.decks ?? []).flatMap((d) => {
    const deck = byId.get(d.deckId)
    if (!deck) return []
    return [{ deckId: d.deckId, name: deck.name, successRate: d.successRate, reviewed: d.reviewed }]
  })

  const rated = rows
    .filter((r) => r.successRate !== null)
    .sort((a, b) => b.successRate! - a.successRate!)
  const unrated = rows
    .filter((r) => r.successRate === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const allEmpty = data !== undefined && rated.length === 0
  const color = subjectColorValue(subject.color)

  let body: React.ReactNode
  let table: React.ReactNode
  if (error && !data) {
    body = (
      <ChartEmpty
        variant="error"
        title={t('analytics.deckSuccessError')}
        onRetry={onRetry}
        height={160}
      />
    )
  } else if (allEmpty) {
    body = (
      <ChartEmpty
        title={t('analytics.deckSuccessEmpty')}
        hint={t(`analytics.deckSuccessHint_${plural(data?.minSample ?? 0)}`, {
          count: data?.minSample ?? 0,
        })}
        height={160}
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
              dataKey="deckId"
              width={Y_WIDTH}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={<DeckTick lookup={rated} />}
            />
            <Tooltip
              cursor={{ fill: chartInk.surface, opacity: 0.4 }}
              content={(props: TooltipProps<number, string>) =>
                renderTooltip(props, t, plural, color)
              }
              isAnimationActive={false}
            />
            <Bar
              dataKey="successRate"
              fill={color}
              maxBarSize={24}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="successRate"
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
              <li key={r.deckId} className="flex items-center gap-2 opacity-70">
                <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{r.name}</span>
                <span className="font-mono text-xs text-text-faint">—</span>
                <span className="text-xs text-text-faint">{t('analytics.notEnoughData')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
    table = (
      <ChartTableView
        columns={[
          { key: 'name', header: t('analytics.colDeck'), render: (r: Row) => r.name },
          {
            key: 'reviewed',
            header: t('analytics.colReviews'),
            align: 'right',
            mono: true,
            render: (r) => r.reviewed,
          },
          {
            key: 'rate',
            header: t('analytics.colSuccess'),
            align: 'right',
            mono: true,
            render: (r) => (r.successRate === null ? '—' : formatPercent(r.successRate)),
          },
        ]}
        rows={[...rated, ...unrated]}
        rowKey={(r) => r.deckId}
        caption={t('analytics.deckSuccessCaption')}
      />
    )
  }

  return (
    <ChartCard
      title={t('analytics.deckSuccessTitle')}
      subtitle={windowLabel}
      isFetching={isFetching}
      showToggle={!allEmpty && !(error && !data)}
      table={table}
    >
      {body}
    </ChartCard>
  )
}

/** Custom Y tick: the deck name in text ink (identity is never colour-only). */
function DeckTick(props: { x?: number; y?: number; payload?: { value?: string }; lookup: Row[] }) {
  const { x = 0, y = 0, payload, lookup } = props
  const row = lookup.find((r) => r.deckId === payload?.value)
  if (!row) return null
  const name = row.name.length > 22 ? `${row.name.slice(0, 21)}…` : row.name
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={-Y_WIDTH + 6}
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

function renderTooltip(
  { active, payload }: TooltipProps<number, string>,
  t: TFunction,
  plural: (n: number) => PluralCategory,
  color: string,
) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload as Row | undefined
  if (!row || row.successRate === null) return null
  return (
    <TooltipShell
      date={t(`analytics.reviewsCount_${plural(row.reviewed)}`, { count: row.reviewed })}
    >
      <TooltipRow colorVar={color} label={row.name} value={formatPercent(row.successRate)} strong />
    </TooltipShell>
  )
}
