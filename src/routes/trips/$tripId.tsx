import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Gauge } from '@/components/charts/gauge'
import { TimeSeries, PRESET_SERIES } from '@/components/charts/time-series'
import { queryTripData, queryTripStats } from '@/lib/duckdb'
import { useDuckDB } from '@/hooks/use-duckdb'
import { formatDate, formatDuration } from '@/lib/utils'
import { deriveTripTs } from '@/lib/csv-parse'
import { Card, CardContent } from '@/components/ui/card'

function TripDetailPage() {
  const { tripId } = Route.useParams()
  const { ready } = useDuckDB()

  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ['trip', tripId, 'rows'],
    queryFn:  () => queryTripData(tripId),
    enabled:  ready,
  })

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['trip', tripId, 'stats'],
    queryFn:  () => queryTripStats(tripId),
    enabled:  ready,
  })

  const tripTs = (() => {
    try { return deriveTripTs(tripId) } catch { return null }
  })()

  const loading = loadingRows || loadingStats

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/trips">
            <ChevronLeft className="h-4 w-4" />
            Trips
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {tripTs ? formatDate(tripTs) : tripId}
          </h2>
          <p className="text-xs text-muted-foreground font-mono">{tripId}</p>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Loading trip data…</p>
      )}

      {/* Gauges */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Gauge label="Peak RPM"   value={stats.peakRpm}    max={8000}  unit=" rpm" color="#3b82f6" />
          <Gauge label="Peak Speed" value={stats.peakSpeed}  max={180}   unit=" mph" color="#22c55e" />
          <Gauge label="Peak Boost" value={stats.peakBoost}  max={30}    unit=" psi" color="#f59e0b" />
          <Gauge label="Avg Boost"  value={stats.avgBoost}   max={30}    unit=" psi" color="#fb923c" />
          <Gauge label="Coolant"    value={stats.peakCoolant} max={250}  unit="°F"  color="#ef4444" />
          <Card className="flex flex-col items-center justify-center p-4">
            <p className="text-xs text-muted-foreground mb-1">Duration</p>
            <p className="text-lg font-bold">{formatDuration(stats.durationSec)}</p>
          </Card>
        </div>
      )}

      {/* Charts */}
      {rows.length > 0 && (
        <div className="space-y-4">
          <TimeSeries
            data={rows}
            title="Performance — RPM, Speed, Boost"
            series={PRESET_SERIES['performance']!}
          />
          <TimeSeries
            data={rows}
            title="Fuel trims — STFT/LTFT B1 & B2"
            series={PRESET_SERIES['fuel']!}
          />
          <TimeSeries
            data={rows}
            title="Temperatures — Coolant, Oil, IAT"
            series={PRESET_SERIES['temps']!}
          />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No data found for this trip. Try syncing again.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/trips/$tripId')({
  component: TripDetailPage,
})
