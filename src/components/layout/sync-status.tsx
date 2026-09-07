import { RefreshCw, CheckCircle2, AlertCircle, Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { SyncProgress } from '@/lib/sync'

interface SyncStatusProps {
  progress:   SyncProgress | null
  syncing:    boolean
  onSync:     () => void
  onRebuild?: () => void
  className?: string
}

export function SyncStatus({ progress, syncing, onSync, onRebuild, className }: SyncStatusProps) {
  const statusIcon = () => {
    if (!progress) return <RefreshCw className="h-4 w-4" />
    switch (progress.phase) {
      case 'done':  return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'error': return <AlertCircle  className="h-4 w-4 text-red-500" />
      default:      return <Loader2 className="h-4 w-4 animate-spin" />
    }
  }

  const statusLabel = () => {
    if (!progress) return null
    switch (progress.phase) {
      case 'listing':     return 'Checking Dropbox…'
      case 'downloading': return `↓ ${progress.current ?? ''}…`
      case 'inserting':   return `Processing…`
      case 'done':        return `Synced ${progress.completed} trip${progress.completed === 1 ? '' : 's'}`
      case 'error': {
        if (!progress.error) return 'Sync failed'
        const short = progress.error.length > 60 ? progress.error.slice(0, 60) + '…' : progress.error
        return `Sync failed: ${short}`
      }
    }
  }

  const label = statusLabel()

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && (
        <span className={cn(
          'text-xs text-muted-foreground break-all max-w-xs',
          progress?.phase === 'error' && 'text-red-400',
        )}>
          {label}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={syncing}
        onClick={onSync}
        className="flex items-center gap-1.5"
      >
        {statusIcon()}
        {!syncing && 'Sync'}
      </Button>
      {onRebuild && (
        <Button
          variant="ghost"
          size="sm"
          disabled={syncing}
          onClick={onRebuild}
          title="Wipe all data and re-ingest from Dropbox"
          className="flex items-center gap-1.5 text-muted-foreground"
        >
          <RotateCcw className="h-4 w-4" />
          Rebuild
        </Button>
      )}
    </div>
  )
}
