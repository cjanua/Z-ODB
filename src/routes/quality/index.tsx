import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useTripSummaries, useManifest } from '@/hooks/use-duckdb'
import { getSpaceUsage } from '@/lib/dropbox'
import { formatDate } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function SpaceCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dropbox-space'],
    queryFn: getSpaceUsage,
    staleTime: 5 * 60_000,
  })

  const pct = data ? (data.used / data.allocated) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dropbox Storage</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Checking…</p>}
        {error && <p className="text-sm text-red-400">Failed to fetch usage</p>}
        {data && (
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span>{formatBytes(data.used)} used</span>
              <span>{formatBytes(data.allocated)} total</span>
            </div>
            <Progress
              value={Math.min(pct, 100)}
              className={`h-3 ${pct > 90 ? '[&>div]:bg-red-500' : pct > 75 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-blue-500'}`}
            />
            <p className="text-xs text-muted-foreground text-right">
              {pct.toFixed(1)}% used · {formatBytes(data.allocated - data.used)} free
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SyncStatsCard() {
  const { trips } = useManifest()
  const { summaries } = useTripSummaries(true)

  const totalRows = trips.reduce((s, t) => s + t.row_count, 0)
  const fragments = summaries.filter(s => s.is_fragment).length
  const fullTrips = summaries.length - fragments

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sync Stats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Trips synced</p>
            <p className="text-lg font-semibold">{fullTrips}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Fragments</p>
            <p className="text-lg font-semibold">{fragments}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total data rows</p>
            <p className="text-lg font-semibold">{totalRows.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">CSV files</p>
            <p className="text-lg font-semibold">{trips.length}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function QualityPage() {
  const { summaries, loading } = useTripSummaries(true)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Data Quality</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Storage · Sync stats · <abbr title="Parameter ID (OBD-II data channel)">PID</abbr> rate · Frame gaps · <abbr title="Global Positioning System">GPS</abbr> quality
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SpaceCard />
        <SyncStatsCard />
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
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/quality/')({
  component: QualityPage,
})
