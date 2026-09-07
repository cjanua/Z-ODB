import React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AlertTriangle, Battery, Gauge, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTripSummaries } from '@/hooks/use-duckdb'
import { formatDate, formatDuration } from '@/lib/utils'
import type { TripSummary } from '@/lib/duckdb'

function fmt(v: number | null | undefined, dec = 1, unit = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function Abbr({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <abbr title={title} className="cursor-help no-underline">{children}</abbr>
  )
}

function GaragePage() {
  const { summaries, loading } = useTripSummaries()

  const recent = summaries[0]
  const last30 = summaries.slice(0, 30)

  // Alert rules
  const alerts: string[] = []
  if (recent) {
    if (Math.abs(recent.ltft_b1_med ?? 0) > 5)
      alerts.push(`Long Term Fuel Trim B1 median ${fmt(recent.ltft_b1_med, 1, '%')} — outside ±5% threshold`)
    if (Math.abs(recent.ltft_b2_med ?? 0) > 5)
      alerts.push(`Long Term Fuel Trim B2 median ${fmt(recent.ltft_b2_med, 1, '%')} — outside ±5% threshold`)
    const bdiv = Math.abs((recent.ltft_b1_med ?? 0) - (recent.ltft_b2_med ?? 0))
    if (bdiv > 4)
      alerts.push(`Bank divergence ${fmt(bdiv, 1, '%')} — B1 vs B2 fuel trim differs > 4%`)
    if ((recent.shutdown_volts ?? 99) < 12.4)
      alerts.push(`Low shutdown voltage ${fmt(recent.shutdown_volts, 2, 'V')} — check battery`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Garage</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {summaries.length} trip{summaries.length !== 1 ? 's' : ''} synced
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* Alert feed */}
      {alerts.length > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4" /> Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {alerts.map(a => (
              <p key={a} className="text-xs text-muted-foreground">{a}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Last trip card */}
      {recent && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LastTripCard trip={recent} />
          <OdometerCard summaries={summaries} />
          <LtftCard summaries={last30} />
          <BatteryCard summaries={last30} />
        </div>
      )}

      {/* Recent trips list */}
      <Card>
        <CardHeader>
          <CardTitle>Recent trips</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trips yet — click <strong>Sync</strong> to pull from Dropbox.
            </p>
          ) : (
            <div className="space-y-1">
              {summaries.slice(0, 15).map(t => (
                <Link
                  key={t.trip_id}
                  to="/trips/$tripId"
                  params={{ tripId: t.trip_id }}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{formatDate(t.ts_start)}</p>
                    <p className="text-xs text-muted-foreground">{formatDuration(t.duration_s)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.miles != null && (
                      <Badge variant="outline" className="text-xs">{t.miles.toFixed(1)} mi</Badge>
                    )}
                    {t.mpg_trip != null && (
                      <Badge variant="secondary" className="text-xs">{t.mpg_trip.toFixed(1)} mpg</Badge>
                    )}
                    {t.max_boost != null && (
                      <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        {t.max_boost.toFixed(1)} psi
                      </Badge>
                    )}
                    {t.n_pulls > 0 && (
                      <span
                        title={`${t.n_pulls} WOT pull${t.n_pulls !== 1 ? 's' : ''}`}
                        className="text-xs text-muted-foreground flex items-center gap-0.5"
                      >
                        <Zap className="h-3 w-3" />{t.n_pulls}
                      </span>
                    )}
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

// ─── Sub-cards ────────────────────────────────────────────────────────────────

function LastTripCard({ trip }: { trip: TripSummary }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Last trip
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-xs text-muted-foreground">{formatDate(trip.ts_start)}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
          <span className="text-muted-foreground">Miles</span>
          <span className="font-medium">{fmt(trip.miles, 1)}</span>
          <span className="text-muted-foreground"><Abbr title="Miles Per Gallon">MPG</Abbr></span>
          <span className="font-medium">{fmt(trip.mpg_trip, 1)}</span>
          <span className="text-muted-foreground">Max boost</span>
          <span className="font-medium text-yellow-500">{fmt(trip.max_boost, 1, ' psi')}</span>
          <span className="text-muted-foreground"><Abbr title="Wide Open Throttle pulls">Pulls</Abbr></span>
          <span className="font-medium">{trip.n_pulls}</span>
          <span className="text-muted-foreground"><Abbr title="Deceleration Fuel Cut-Off">DFCO</Abbr></span>
          <span className="font-medium">{fmt(trip.dfco_pct, 1, '%')}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function OdometerCard({ summaries }: { summaries: TripSummary[] }) {
  const totalMiles = summaries.reduce((s, t) => s + (t.miles ?? 0), 0)
  const lastOdo = summaries[0]?.fuel_level_end  // placeholder; odo not stored in summary
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Lifetime</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
          <span className="text-muted-foreground">Trips</span>
          <span className="font-medium">{summaries.length}</span>
          <span className="text-muted-foreground">Miles (logged)</span>
          <span className="font-medium">{totalMiles.toFixed(0)}</span>
          <span className="text-muted-foreground">Total fuel</span>
          <span className="font-medium">
            {summaries.reduce((s, t) => s + (t.fuel_gal ?? 0), 0).toFixed(1)} gal
          </span>
          <span className="text-muted-foreground">Total pulls</span>
          <span className="font-medium">
            {summaries.reduce((s, t) => s + t.n_pulls, 0)}
          </span>
        </div>
        {void lastOdo}
      </CardContent>
    </Card>
  )
}

function LtftCard({ summaries }: { summaries: TripSummary[] }) {
  const b1Vals = summaries.map(t => t.ltft_b1_med).filter(v => v != null) as number[]
  const b2Vals = summaries.map(t => t.ltft_b2_med).filter(v => v != null) as number[]
  const b1Med = b1Vals.length ? b1Vals.reduce((a, b) => a + b, 0) / b1Vals.length : null
  const b2Med = b2Vals.length ? b2Vals.reduce((a, b) => a + b, 0) / b2Vals.length : null
  const alert = Math.abs(b1Med ?? 0) > 5 || Math.abs(b2Med ?? 0) > 5

  return (
    <Card className={alert ? 'border-yellow-500/40' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {alert && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />}
          Fuel Trims (30-trip avg)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
          <span className="text-muted-foreground"><Abbr title="Long Term Fuel Trim — Bank 1">LTFT B1</Abbr></span>
          <span className={`font-medium ${Math.abs(b1Med ?? 0) > 5 ? 'text-yellow-500' : ''}`}>
            {fmt(b1Med, 1, '%')}
          </span>
          <span className="text-muted-foreground"><Abbr title="Long Term Fuel Trim — Bank 2">LTFT B2</Abbr></span>
          <span className={`font-medium ${Math.abs(b2Med ?? 0) > 5 ? 'text-yellow-500' : ''}`}>
            {fmt(b2Med, 1, '%')}
          </span>
          <span className="text-muted-foreground">Divergence</span>
          <span className={`font-medium ${Math.abs((b1Med ?? 0) - (b2Med ?? 0)) > 4 ? 'text-red-400' : ''}`}>
            {b1Med != null && b2Med != null ? fmt(Math.abs(b1Med - b2Med), 1, '%') : '—'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Alert thresholds: |<Abbr title="Long Term Fuel Trim">LTFT</Abbr>| &gt; 5%, divergence &gt; 4%
        </p>
      </CardContent>
    </Card>
  )
}

function BatteryCard({ summaries }: { summaries: TripSummary[] }) {
  const voltVals = summaries.map(t => t.shutdown_volts).filter(v => v != null) as number[]
  const low = voltVals.filter(v => v < 12.4)
  const latest = voltVals[0]

  return (
    <Card className={(latest ?? 99) < 12.4 ? 'border-red-500/40' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Battery className="h-4 w-4" /> Battery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
          <span className="text-muted-foreground">Latest shutdown V</span>
          <span className={`font-medium ${(latest ?? 99) < 12.4 ? 'text-red-400' : ''}`}>
            {fmt(latest, 2, 'V')}
          </span>
          <span className="text-muted-foreground">Low readings</span>
          <span className="font-medium">{low.length} / {voltVals.length}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Alert threshold: &lt; 12.4 V</p>
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute('/dashboard/')({
  component: GaragePage,
})
