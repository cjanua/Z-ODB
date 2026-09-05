import { createFileRoute, Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useManifest } from '@/hooks/use-duckdb'
import { formatDate, formatDuration } from '@/lib/utils'

function TripsPage() {
  const { trips, loading, error } = useManifest()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trips</h2>
        <p className="text-muted-foreground text-sm mt-1">All synced OBD logs</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trip list</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error  && <p className="text-sm text-red-400">{error}</p>}

          {!loading && trips.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No trips yet — use the Sync button to pull from Dropbox.
            </p>
          )}

          {trips.length > 0 && (
            <div className="space-y-2">
              {trips.map(t => (
                <Link
                  key={t.trip_id}
                  to="/trips/$tripId"
                  params={{ tripId: t.trip_id }}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors group"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm group-hover:text-foreground">
                      {formatDate(t.trip_ts)}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {t.trip_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {formatDuration(t.row_count * 0.5)}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {t.row_count.toLocaleString()} rows
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/trips/')({
  component: TripsPage,
})
