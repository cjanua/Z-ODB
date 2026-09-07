import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { usePulls, useTripSummaries, useAccelRuns } from '@/hooks/use-duckdb'
import { formatDate } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function PerformancePage() {
  const { data: pulls      = [], isLoading: loadingPulls } = usePulls()
  const { data: accelRuns  = [] }                          = useAccelRuns()
  const { summaries } = useTripSummaries()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Performance</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Pull library · Boost envelope · <abbr title="Estimated horsepower (MAF × 9.7)">hp_est</abbr> · Spool trends
        </p>
      </div>

      {loadingPulls && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total pulls</p>
            <p className="text-2xl font-bold mt-1">{pulls.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Peak boost (all-time)</p>
            <p className="text-2xl font-bold mt-1 text-yellow-500">
              {fmt(Math.max(0, ...pulls.map(p => p.peak_boost ?? 0)), 1, ' psi')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Peak <abbr title="Estimated horsepower (MAF × 9.7)">hp_est</abbr> (all-time)</p>
            <p className="text-2xl font-bold mt-1">
              {fmt(Math.max(0, ...pulls.map(p => p.hp_est_peak ?? 0)), 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pull table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pull library ({pulls.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pulls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pulls detected yet. <abbr title="Wide Open Throttle">WOT</abbr> (&gt;70% pedal, &gt;3 psi boost, ≥2 s) required.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-1 pr-4">Date</th>
                    <th className="text-right pr-3">Duration</th>
                    <th className="text-right pr-3"><abbr title="Revolutions Per Minute span">RPM span</abbr></th>
                    <th className="text-right pr-3">Peak boost</th>
                    <th className="text-right pr-3"><abbr title="Estimated horsepower (MAF × 9.7)">hp_est</abbr></th>
                    <th className="text-right pr-3"><abbr title="Time to spool from 0 to 10 psi">Spool 0→10</abbr></th>
                    <th className="text-right pr-3"><abbr title="Lambda — commanded air/fuel equivalence ratio (1.0 = stoich)">Min λ</abbr></th>
                    <th className="text-right">Timing floor</th>
                  </tr>
                </thead>
                <tbody>
                  {pulls.map((p, i) => (
                    <tr key={i} className="border-b hover:bg-accent/20">
                      <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
                        {formatDate(p.t_start)}
                      </td>
                      <td className="text-right pr-3">{fmt(p.duration_s, 1, 's')}</td>
                      <td className="text-right pr-3 text-xs">
                        {fmt(p.rpm_min, 0)}–{fmt(p.rpm_max, 0)}
                      </td>
                      <td className="text-right pr-3 text-yellow-500 font-medium">
                        {fmt(p.peak_boost, 1, ' psi')}
                      </td>
                      <td className="text-right pr-3 font-medium">{fmt(p.hp_est_peak, 0)}</td>
                      <td className="text-right pr-3">{fmt(p.spool_0_10, 1, 's')}</td>
                      <td className="text-right pr-3">{fmt(p.min_lambda, 3)}</td>
                      <td className={`text-right ${(p.timing_floor ?? 99) < 10 ? 'text-red-400' : ''}`}>
                        {fmt(p.timing_floor, 1, '°')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Acceleration runs — 0-60 / 0-30 / 30-60 */}
      {accelRuns.length > 0 && (() => {
        const best60  = Math.min(...accelRuns.map(r => r.t_0_60 ?? Infinity))
        const best30  = Math.min(...accelRuns.map(r => r.t_0_30 ?? Infinity))
        return (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Best 0–60</p>
                  <p className="text-2xl font-bold mt-1">
                    {isFinite(best60) ? `${best60.toFixed(2)} s` : '—'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Best 0–30</p>
                  <p className="text-2xl font-bold mt-1">
                    {isFinite(best30) ? `${best30.toFixed(2)} s` : '—'}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Total runs logged</p>
                  <p className="text-2xl font-bold mt-1">{accelRuns.length}</p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Acceleration runs ({accelRuns.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-1 pr-4">Date</th>
                        <th className="text-right pr-3">0–30</th>
                        <th className="text-right pr-3">0–60</th>
                        <th className="text-right pr-3">30–60</th>
                        <th className="text-right">Peak mph</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accelRuns.map((r, i) => (
                        <tr key={i} className="border-b hover:bg-accent/20">
                          <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
                            {formatDate(r.t_start)}
                          </td>
                          <td className="text-right pr-3">
                            {r.t_0_30 != null ? `${r.t_0_30.toFixed(2)} s` : '—'}
                          </td>
                          <td className={`text-right pr-3 font-medium ${r.t_0_60 === best60 ? 'text-yellow-500' : ''}`}>
                            {r.t_0_60 != null ? `${r.t_0_60.toFixed(2)} s` : '—'}
                          </td>
                          <td className="text-right pr-3">
                            {r.t_30_60 != null ? `${r.t_30_60.toFixed(2)} s` : '—'}
                          </td>
                          <td className="text-right">
                            {r.peak_speed != null ? `${r.peak_speed.toFixed(1)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )
      })()}

      {/* Per-trip pull summary */}
      {summaries.some(s => s.n_pulls > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pulls per trip</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {summaries.filter(s => s.n_pulls > 0).map(s => (
                <div key={s.trip_id} className="flex items-center gap-2 border rounded px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground">{formatDate(s.ts_start)}</span>
                  <Badge variant="secondary">{s.n_pulls} pulls</Badge>
                  <span className="text-yellow-500 font-medium">{fmt(s.max_boost, 1, ' psi')}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/performance/')({
  component: PerformancePage,
})
