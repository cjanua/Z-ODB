import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTripSummaries } from '@/hooks/use-duckdb'
import { formatDate } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function EnginePage() {
  const { summaries, loading } = useTripSummaries()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Engine Health</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Fuel trims · Knock proxy · Turbos · Fuel system & electrical
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* Fuel Trims per trip */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base"><abbr title="Long Term Fuel Trim">LTFT</abbr> per trip (closed-loop median)</CardTitle>
        </CardHeader>
        <CardContent>
          {summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'No data — sync trips first.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-1 pr-4">Trip</th>
                    <th className="text-right pr-4"><abbr title="Long Term Fuel Trim — Bank 1">LTFT B1</abbr></th>
                    <th className="text-right pr-4"><abbr title="Long Term Fuel Trim — Bank 2">LTFT B2</abbr></th>
                    <th className="text-right pr-4"><abbr title="Short Term Fuel Trim Interquartile Range — Bank 1">STFT IQR B1</abbr></th>
                    <th className="text-right pr-4"><abbr title="Short Term Fuel Trim Interquartile Range — Bank 2">STFT IQR B2</abbr></th>
                    <th className="text-right">Timing <abbr title="Wide Open Throttle">WOT</abbr> floor</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(t => {
                    const ltftAlert = Math.abs(t.ltft_b1_med ?? 0) > 5 || Math.abs(t.ltft_b2_med ?? 0) > 5
                    return (
                      <tr key={t.trip_id} className={`border-b ${ltftAlert ? 'text-yellow-500' : ''}`}>
                        <td className="py-1 pr-4 text-muted-foreground">{formatDate(t.ts_start)}</td>
                        <td className="text-right pr-4">{fmt(t.ltft_b1_med, 1, '%')}</td>
                        <td className="text-right pr-4">{fmt(t.ltft_b2_med, 1, '%')}</td>
                        <td className="text-right pr-4">{fmt(t.stft_iqr_b1, 1, '%')}</td>
                        <td className="text-right pr-4">{fmt(t.stft_iqr_b2, 1, '%')}</td>
                        <td className="text-right">{fmt(t.timing_wot_floor, 1, '°')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Alert guides: |<abbr title="Long Term Fuel Trim">LTFT</abbr>| &gt; 5%, bank divergence &gt; 4%
          </p>
        </CardContent>
      </Card>

      {/* Turbo health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Turbo peaks per trip</CardTitle>
        </CardHeader>
        <CardContent>
          {summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'No data.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-1 pr-4">Trip</th>
                    <th className="text-right pr-4">Max boost</th>
                    <th className="text-right pr-4">Max turbo</th>
                    <th className="text-right">Shutdown V</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(t => (
                    <tr key={t.trip_id} className="border-b">
                      <td className="py-1 pr-4 text-muted-foreground">{formatDate(t.ts_start)}</td>
                      <td className="text-right pr-4 text-yellow-500">{fmt(t.max_boost, 1, ' psi')}</td>
                      <td className="text-right pr-4">{fmt(t.max_turbo, 0, ' rpm')}</td>
                      <td className={`text-right ${(t.shutdown_volts ?? 99) < 12.4 ? 'text-red-400' : ''}`}>
                        {fmt(t.shutdown_volts, 2, 'V')}
                      </td>
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

export const Route = createFileRoute('/engine/')({
  component: EnginePage,
})
