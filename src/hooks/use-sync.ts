import { useState, useCallback } from 'react'
import { runSync, type SyncProgress } from '@/lib/sync'

const DROPBOX_FOLDER = import.meta.env['VITE_DROPBOX_FOLDER'] as string ?? '/Apps/OBD Fusion'

export function useSync(onComplete?: () => void) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [syncing,  setSyncing]  = useState(false)

  const sync = useCallback(async () => {
    setSyncing(true)
    setProgress({ phase: 'listing', total: 0, completed: 0 })
    try {
      await runSync(DROPBOX_FOLDER, p => {
        setProgress(p)
        if (p.phase === 'done' || p.phase === 'error') {
          setSyncing(false)
          onComplete?.()
        }
      })
    } catch {
      setSyncing(false)
    }
  }, [onComplete])

  return { progress, syncing, sync }
}
