import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTripSummaries } from '@/hooks/use-duckdb'
import { formatDate } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function QualityPage() {
  const { summaries, loading } = useTripSummaries(true)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Data Quality</h2>
        <p className="text-muted-foreground text-sm mt-1">
          <abbr title="Parameter ID (OBD-II data channel)">PID</abbr> rate · Frame gaps · <abbr title="Global Positioning System">GPS</abbr> quality · Dead channels
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link health per trip</CardTitle>
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
                    <th className="text-right pr-4"><abbr title="Parameter ID refresh rate (median)">PID Hz (med)</abbr></th>
                    <th className="text-right pr-4">Frame gap max</th>
                    <th className="text-right pr-4"><abbr title="Time to first GPS fix">GPS fix (s)</abbr></th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(t => {
                    const pidAlert = (t.pid_hz_med ?? 99) < 10
                    return (
                      <tr key={t.trip_id} className={`border-b ${t.is_fragment ? 'opacity-50' : ''}`}>
                        <td className="py-1 pr-4 text-muted-foreground">
                          {formatDate(t.ts_start)}
                          {t.is_fragment && <span className="ml-1 text-xs text-yellow-500">(fragment)</span>}
                        </td>
                        <td className={`text-right pr-4 ${pidAlert ? 'text-yellow-500' : ''}`}>
                          {fmt(t.pid_hz_med, 1, ' Hz')}
                        </td>
                        <td className={`text-right pr-4 ${(t.frame_gap_max ?? 0) > 5 ? 'text-yellow-500' : ''}`}>
                          {fmt(t.frame_gap_max, 2, 's')}
                        </td>
                        <td className="text-right">
                          {t.gps_fix_s != null
                            ? `${t.gps_fix_s.toFixed(0)} s`
                            : '— (no fix)'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Dead-channel detection (per-trip × channel matrix) requires per-trip channel scan — coming next.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/quality/')({
  component: QualityPage,
})
