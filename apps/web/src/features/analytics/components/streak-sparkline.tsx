import { Line, LineChart, ResponsiveContainer, type DotProps } from 'recharts'
import { chartInk, accentSeries } from '../chart-theme'

/**
 * A bare 30-point streak trend (spec §3): the line in the de-emphasis ink, the
 * current day accented. No axes, grid, or tooltip — a sparkline, not a chart;
 * the twin table's value column carries the numbers. Static under reduced motion.
 */
export function StreakSparkline({ data, reduce }: { data: number[]; reduce: boolean }) {
  const points = data.map((v, i) => ({ i, v }))
  const lastIndex = points.length - 1
  return (
    <ResponsiveContainer width="100%" height={28}>
      <LineChart accessibilityLayer data={points} margin={{ top: 3, right: 3, bottom: 0, left: 0 }}>
        <Line
          dataKey="v"
          stroke={chartInk.faint}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          isAnimationActive={!reduce}
          animationDuration={180}
          dot={(props: DotProps & { index?: number }) =>
            props.index === lastIndex ? (
              <circle
                key="last"
                cx={props.cx}
                cy={props.cy}
                r={2.5}
                fill={accentSeries.line}
                stroke={chartInk.surface}
                strokeWidth={1.5}
              />
            ) : (
              <g key={props.index} />
            )
          }
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
