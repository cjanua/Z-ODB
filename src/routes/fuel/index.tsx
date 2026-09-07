import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTripSummaries } from '@/hooks/use-duckdb'
import { formatDate } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function FuelPage() {
  const { summaries, loading } = useTripSummaries()

  const totalMiles = summaries.reduce((s, t) => s + (t.miles ?? 0), 0)
  const totalGal   = summaries.reduce((s, t) => s + (t.fuel_gal ?? 0), 0)
  const lifetimeMpg = totalGal > 0 ? totalMiles / totalGal : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Fuel & Economy</h2>
        <p className="text-muted-foreground text-sm mt-1">
          <abbr title="Miles Per Gallon">MPG</abbr> trends · <abbr title="Deceleration Fuel Cut-Off">DFCO</abbr> utilization · Tank ledger
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* Lifetime summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Lifetime miles', value: totalMiles.toFixed(0) },
          { label: 'Lifetime fuel',  value: fmt(totalGal, 1, ' gal') },
          { label: 'Lifetime MPG',   value: fmt(lifetimeMpg, 1) },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-bold mt-1">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* MPG per trip table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base"><abbr title="Miles Per Gallon">MPG</abbr> & efficiency per trip</CardTitle>
        </CardHeader>
        <CardContent>
          {summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data — sync trips first.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-1 pr-4">Trip</th>
                    <th className="text-right pr-4">Miles</th>
                    <th className="text-right pr-4">Fuel (gal)</th>
                    <th className="text-right pr-4"><abbr title="Miles Per Gallon">MPG</abbr></th>
                    <th className="text-right pr-4">Avg mph</th>
                    <th className="text-right pr-4"><abbr title="Deceleration Fuel Cut-Off">DFCO</abbr> %</th>
                    <th className="text-right pr-4">Idle %</th>
                    <th className="text-right">Accel %</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(t => (
                    <tr key={t.trip_id} className="border-b">
                      <td className="py-1 pr-4 text-muted-foreground">{formatDate(t.ts_start)}</td>
                      <td className="text-right pr-4">{fmt(t.miles, 1)}</td>
                      <td className="text-right pr-4">{fmt(t.fuel_gal, 2)}</td>
                      <td className="text-right pr-4 font-medium">{fmt(t.mpg_trip, 1)}</td>
                      <td className="text-right pr-4">{fmt(t.avg_moving_mph, 1)}</td>
                      <td className="text-right pr-4 text-green-400">{fmt(t.dfco_pct, 1, '%')}</td>
                      <td className="text-right pr-4">{fmt(t.idle_pct, 1, '%')}</td>
                      <td className="text-right">{fmt(t.accel_pct, 1, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/fuel/')({
  component: FuelPage,
})
