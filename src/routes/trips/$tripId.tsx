import React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TimeSeries, PRESET_SERIES } from '@/components/charts/time-series'
import { queryTripData } from '@/lib/duckdb'
import { useDuckDB, useTripSummary } from '@/hooks/use-duckdb'
import { formatDate, formatDuration } from '@/lib/utils'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function TripDetailPage() {
  const { tripId } = Route.useParams()
  const { ready }  = useDuckDB()

  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ['trip', tripId, 'rows'],
    queryFn:  () => queryTripData(tripId),
    enabled:  ready,
  })

  const { data: summary, isLoading: loadingSummary } = useTripSummary(tripId)

  const loading = loadingRows || loadingSummary

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/trips"><ChevronLeft className="h-4 w-4" /> Trips</Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {summary ? formatDate(summary.ts_start) : tripId}
          </h2>
          <p className="text-xs text-muted-foreground font-mono">{tripId}</p>
        </div>
        {summary?.era_id && (
          <Badge variant="outline" className="ml-auto">{summary.era_id}</Badge>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading trip data…</p>}

      {/* Summary stat grid */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Miles"      value={fmt(summary.miles, 1)} />
          <StatTile label={<abbr title="Miles Per Gallon">MPG</abbr>}       value={fmt(summary.mpg_trip, 1)} />
          <StatTile label="Duration"   value={formatDuration(summary.duration_s)} />
          <StatTile label="Peak Boost" value={fmt(summary.max_boost, 1, ' psi')} accent />
          <StatTile label={<abbr title="Revolutions Per Minute">Peak RPM</abbr>} value={fmt(summary.max_rpm, 0)} />
          <StatTile label={<abbr title="Wide Open Throttle pulls">Pulls</abbr>}  value={String(summary.n_pulls)} />
          <StatTile label={<abbr title="Long Term Fuel Trim — Bank 1">LTFT B1</abbr>} value={fmt(summary.ltft_b1_med, 1, '%')} warn={Math.abs(summary.ltft_b1_med ?? 0) > 5} />
          <StatTile label={<abbr title="Long Term Fuel Trim — Bank 2">LTFT B2</abbr>} value={fmt(summary.ltft_b2_med, 1, '%')} warn={Math.abs(summary.ltft_b2_med ?? 0) > 5} />
          <StatTile label="Oil Start"  value={fmt(summary.oil_start_f, 0, '°F')} />
          <StatTile label="Coolant Max" value={fmt(summary.coolant_max, 0, '°F')} />
          <StatTile label={<abbr title="Deceleration Fuel Cut-Off">DFCO</abbr>} value={fmt(summary.dfco_pct, 1, '%')} />
          <StatTile label="Shutdown V" value={fmt(summary.shutdown_volts, 2, 'V')} warn={(summary.shutdown_volts ?? 99) < 12.4} />
        </div>
      )}

      {/* Charts */}
      {rows.length > 0 && (
        <div className="space-y-4">
          <TimeSeries data={rows} title="RPM · Speed · Boost"            series={PRESET_SERIES['performance']!} />
          <TimeSeries data={rows} title="Pedal · Throttle · Load"         series={PRESET_SERIES['throttle']!} />
          <TimeSeries data={rows} title="Fuel Trims — Short/Long Term B1 & B2" series={PRESET_SERIES['fuel']!} />
          <TimeSeries data={rows} title="Temperatures"                    series={PRESET_SERIES['temps']!} />
          <TimeSeries data={rows} title="Turbos A & B · Boost"            series={PRESET_SERIES['turbos']!} />
          <TimeSeries data={rows} title="Fuel Economy"                    series={PRESET_SERIES['economy']!} />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No data found for this trip.
          </CardContent>
        </Card>
      )}

      {/* Pulls list */}
      {summary && summary.n_pulls > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-yellow-500" />
              Detected pulls ({summary.n_pulls})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Navigate to Performance view for per-pull analysis.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

interface StatTileProps {
  label:   React.ReactNode
  value:   string
  accent?: boolean
  warn?:   boolean
}

function StatTile({ label, value, accent, warn }: StatTileProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-base font-bold ${accent ? 'text-yellow-500' : warn ? 'text-red-400' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute('/trips/$tripId')({
  component: TripDetailPage,
})
