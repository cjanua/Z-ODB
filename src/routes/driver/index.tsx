import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTripSummaries } from '@/hooks/use-duckdb'
import { formatDate, formatDuration } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function DriverPage() {
  const { summaries, loading } = useTripSummaries()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Driver</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Drive states · Pedal behavior · Aggression · Patterns
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drive state summary per trip</CardTitle>
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
                    <th className="text-right pr-4">Duration</th>
                    <th className="text-right pr-4"><abbr title="Wide Open Throttle">WOT</abbr> (s)</th>
                    <th className="text-right pr-4"><abbr title="Deceleration Fuel Cut-Off">DFCO</abbr> %</th>
                    <th className="text-right">Idle %</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(t => (
                    <tr key={t.trip_id} className="border-b">
                      <td className="py-1 pr-4 text-muted-foreground">{formatDate(t.ts_start)}</td>
                      <td className="text-right pr-4">{formatDuration(t.duration_s)}</td>
                      <td className="text-right pr-4 text-yellow-500">{fmt(t.wot_s, 0, 's')}</td>
                      <td className="text-right pr-4 text-green-400">{fmt(t.dfco_pct, 1, '%')}</td>
                      <td className="text-right">{fmt(t.idle_pct, 1, '%')}</td>
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

export const Route = createFileRoute('/driver/')({
  component: DriverPage,
})
