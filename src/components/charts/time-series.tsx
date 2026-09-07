import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OBDRow } from '@/lib/duckdb'

interface TimeSeriesProps {
  data:   OBDRow[]
  title?: string
  series: SeriesConfig[]
}

export interface SeriesConfig {
  key:      keyof OBDRow
  label:    string
  color:    string
  unit?:    string
  yAxisId?: 'left' | 'right'
  scale?:   number   // multiply value before display (e.g. rpm/1000)
}

export const PRESET_SERIES: Record<string, SeriesConfig[]> = {
  performance: [
    { key: 'rpm',       label: 'RPM',   color: '#3b82f6', unit: 'rpm',  yAxisId: 'left',  scale: 0.001 },
    { key: 'speed_mph', label: 'Speed', color: '#22c55e', unit: 'mph',  yAxisId: 'right' },
    { key: 'boost_psi', label: 'Boost', color: '#f59e0b', unit: 'psi',  yAxisId: 'right' },
  ],
  throttle: [
    { key: 'pedal_pct',    label: 'Pedal %',    color: '#a78bfa', unit: '%', yAxisId: 'left' },
    { key: 'throttle_pct', label: 'Throttle %', color: '#60a5fa', unit: '%', yAxisId: 'left' },
    { key: 'load_pct',     label: 'Load %',     color: '#34d399', unit: '%', yAxisId: 'left' },
  ],
  fuel: [
    { key: 'stft_b1', label: 'STFT B1', color: '#f43f5e', unit: '%', yAxisId: 'left' },
    { key: 'ltft_b1', label: 'LTFT B1', color: '#fb923c', unit: '%', yAxisId: 'left' },
    { key: 'stft_b2', label: 'STFT B2', color: '#a78bfa', unit: '%', yAxisId: 'left' },
    { key: 'ltft_b2', label: 'LTFT B2', color: '#818cf8', unit: '%', yAxisId: 'left' },
  ],
  temps: [
    { key: 'coolant_f', label: 'Coolant', color: '#ef4444', unit: '°F', yAxisId: 'left' },
    { key: 'oil_f',     label: 'Oil',     color: '#f97316', unit: '°F', yAxisId: 'left' },
    { key: 'ambient_f', label: 'Ambient', color: '#64748b', unit: '°F', yAxisId: 'left' },
    { key: 'iat_f',     label: 'IAT',     color: '#eab308', unit: '°F', yAxisId: 'left' },
  ],
  turbos: [
    { key: 'turbo_a',   label: 'Turbo A', color: '#06b6d4', unit: 'rpm', yAxisId: 'left',  scale: 0.001 },
    { key: 'turbo_b',   label: 'Turbo B', color: '#0ea5e9', unit: 'rpm', yAxisId: 'left',  scale: 0.001 },
    { key: 'boost_psi', label: 'Boost',   color: '#f59e0b', unit: 'psi', yAxisId: 'right' },
  ],
  economy: [
    { key: 'mpg_inst',  label: 'MPG inst', color: '#22c55e', unit: 'mpg', yAxisId: 'left' },
    { key: 'fuel_galhr',label: 'gal/hr',   color: '#f59e0b', unit: 'gal/hr', yAxisId: 'right' },
    { key: 'speed_mph', label: 'Speed',    color: '#60a5fa', unit: 'mph', yAxisId: 'right' },
  ],
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]!)
}

export function TimeSeries({ data, title, series }: TimeSeriesProps) {
  const sampled = downsample(data, 600)

  // Scale values if needed and check for data presence
  const activeSeries = series.filter(s => {
    const key = s.key as string
    return sampled.some(r => (r as Record<string, unknown>)[key] != null)
  })

  const scaledData = sampled.map(row => {
    const out: Record<string, unknown> = { ...row }
    for (const s of series) {
      if (s.scale) {
        const k = s.key as string
        const v = (row as Record<string, unknown>)[k]
        if (v != null) out[k] = (v as number) * s.scale
      }
    }
    return out
  })

  return (
    <Card>
      {title && (
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        {activeSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data for this panel</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={scaledData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="t_rel"
                tickFormatter={formatTime}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                label={{ value: 'Time (m:ss)', position: 'insideBottomRight', offset: -4, fontSize: 11 }}
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
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => {
                  const s = series.find(s => s.label === name)
                  const display = s?.scale ? value / s.scale : value
                  return [`${display.toFixed(1)}${s?.unit ?? ''}`, name]
                }}
                labelFormatter={v => `t = ${formatTime(Number(v))}`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeSeries.map(s => (
                <Line
                  key={String(s.key)}
                  yAxisId={s.yAxisId ?? 'left'}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
