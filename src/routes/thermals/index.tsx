import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTripSummaries } from '@/hooks/use-duckdb'
import { formatDate } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 0, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function ThermalsPage() {
  const { summaries, loading } = useTripSummaries()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Thermals</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Warmup curves · Oil–coolant delta · Heat soak · Catalyst temps
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Warmup & thermal summary per trip</CardTitle>
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
                    <th className="text-right pr-4">Ambient</th>
                    <th className="text-right pr-4">Oil start</th>
                    <th className="text-right pr-4">Time to oil 180°F</th>
                    <th className="text-right">Coolant max</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(t => (
                    <tr key={t.trip_id} className="border-b">
                      <td className="py-1 pr-4 text-muted-foreground">{formatDate(t.ts_start)}</td>
                      <td className="text-right pr-4">{fmt(t.ambient_med, 0, '°F')}</td>
                      <td className="text-right pr-4">{fmt(t.oil_start_f, 0, '°F')}</td>
                      <td className="text-right pr-4">
                        {t.t_to_oil_180s != null
                          ? `${(t.t_to_oil_180s / 60).toFixed(1)} min`
                          : '— (never reached)'}
                      </td>
                      <td className="text-right">{fmt(t.coolant_max, 0, '°F')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            <abbr title="Intake Air Temperature">IAT</abbr> panel pending — channel not yet active. Catalyst temps shown when logged.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/thermals/')({
  component: ThermalsPage,
})
