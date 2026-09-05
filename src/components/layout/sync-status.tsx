import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSync } from '@/hooks/use-sync'

interface SyncStatusProps {
  onSynced?: () => void
  className?: string
}

export function SyncStatus({ onSynced, className }: SyncStatusProps) {
  const { progress, syncing, sync } = useSync(onSynced)

  const statusIcon = () => {
    if (!progress) return <RefreshCw className="h-4 w-4" />
    switch (progress.phase) {
      case 'done':  return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'error': return <AlertCircle  className="h-4 w-4 text-red-500" />
      default:      return <Loader2 className="h-4 w-4 animate-spin" />
    }
  }

  const statusLabel = () => {
    if (!progress) return 'Sync'
    switch (progress.phase) {
      case 'listing':     return 'Checking Dropbox…'
      case 'downloading': return `Downloading ${progress.current ?? ''}…`
      case 'inserting':   return `Processing ${progress.current ?? ''}…`
      case 'done':        return `Synced ${progress.completed} trip${progress.completed === 1 ? '' : 's'}`
      case 'error':       return 'Sync failed'
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className={cn(
        'text-xs text-muted-foreground truncate max-w-40',
        progress?.phase === 'error' && 'text-red-400',
      )}>
        {statusLabel()}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={syncing}
        onClick={() => void sync()}
        className="flex items-center gap-1.5"
      >
        {statusIcon()}
        {!syncing && 'Sync'}
      </Button>
    </div>
  )
}
