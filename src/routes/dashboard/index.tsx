import { createFileRoute, Link } from '@tanstack/react-router'
import { Activity, Gauge as GaugeIcon, Route, Clock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useManifest } from '@/hooks/use-duckdb'
import { formatDate, formatDuration } from '@/lib/utils'

function DashboardPage() {
  const { trips, loading } = useManifest()

  const recent = trips[0]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {trips.length} trip{trips.length !== 1 ? 's' : ''} synced
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total trips"
          value={loading ? '…' : String(trips.length)}
          icon={Route}
        />
        <StatCard
          label="Latest trip"
          value={recent ? formatDate(recent.trip_ts) : '—'}
          icon={Clock}
          small
        />
        <StatCard
          label="Rows logged"
          value={loading ? '…' : trips.reduce((s, t) => s + t.row_count, 0).toLocaleString()}
          icon={Activity}
        />
        <StatCard
          label="Latest rows"
          value={recent ? recent.row_count.toLocaleString() : '—'}
          icon={GaugeIcon}
        />
      </div>

      {/* Recent trips */}
      <Card>
        <CardHeader>
          <CardTitle>Recent trips</CardTitle>
          <CardDescription>Click a trip to view detailed charts</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : trips.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trips yet — click <strong>Sync</strong> to pull from Dropbox.
            </p>
          ) : (
            <div className="space-y-2">
              {trips.slice(0, 10).map(t => (
                <Link
                  key={t.trip_id}
                  to="/trips/$tripId"
                  params={{ tripId: t.trip_id }}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{formatDate(t.trip_ts)}</p>
                    <p className="text-xs text-muted-foreground">{t.trip_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">{t.row_count.toLocaleString()} rows</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(t.row_count * 0.5)}
                    </span>
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

interface StatCardProps {
  label: string
  value: string
  icon:  React.ComponentType<{ className?: string }>
  small?: boolean
}

function StatCard({ label, value, icon: Icon, small }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className={small ? 'text-sm font-semibold' : 'text-2xl font-bold'}>{value}</p>
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute('/dashboard/')({
  component: DashboardPage,
})
