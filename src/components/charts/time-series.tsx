import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OBDRow } from '@/lib/csv-parse'

interface TimeSeriesProps {
  data:    OBDRow[]
  title?:  string
  series:  SeriesConfig[]
}

export interface SeriesConfig {
  key:    keyof OBDRow
  label:  string
  color:  string
  unit?:  string
  yAxisId?: 'left' | 'right'
}

const PRESET_SERIES: Record<string, SeriesConfig[]> = {
  performance: [
    { key: 'rpm',       label: 'RPM',       color: '#3b82f6', unit: 'rpm',  yAxisId: 'left'  },
    { key: 'speed_mph', label: 'Speed',     color: '#22c55e', unit: 'mph',  yAxisId: 'right' },
    { key: 'boost_psi', label: 'Boost',     color: '#f59e0b', unit: 'psi',  yAxisId: 'right' },
  ],
  fuel: [
    { key: 'stft_b1_pct', label: 'STFT B1', color: '#f43f5e', unit: '%', yAxisId: 'left' },
    { key: 'ltft_b1_pct', label: 'LTFT B1', color: '#fb923c', unit: '%', yAxisId: 'left' },
    { key: 'stft_b2_pct', label: 'STFT B2', color: '#a78bfa', unit: '%', yAxisId: 'left' },
    { key: 'ltft_b2_pct', label: 'LTFT B2', color: '#818cf8', unit: '%', yAxisId: 'left' },
  ],
  temps: [
    { key: 'coolant_temp_f', label: 'Coolant', color: '#ef4444', unit: '°F', yAxisId: 'left' },
    { key: 'oil_temp_f',     label: 'Oil',     color: '#f97316', unit: '°F', yAxisId: 'left' },
    { key: 'iat_f',          label: 'IAT',     color: '#eab308', unit: '°F', yAxisId: 'left' },
  ],
}

export { PRESET_SERIES }

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Downsample to at most `n` evenly-spaced points (keeps chart snappy)
function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]!)
}

export function TimeSeries({ data, title, series }: TimeSeriesProps) {
  const sampled = downsample(data, 500)

  return (
    <Card>
      {title && (
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={sampled} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="time_sec"
              tickFormatter={formatTime}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              label={{ value: 'Time', position: 'insideBottomRight', offset: -4, fontSize: 11 }}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              width={45}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border:     '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                const s = series.find(s => s.label === name)
                return [`${value.toFixed(1)}${s?.unit ?? ''}`, name]
              }}
              labelFormatter={v => `t = ${formatTime(Number(v))}`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map(s => (
              <Line
                key={String(s.key)}
                yAxisId={s.yAxisId ?? 'left'}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
