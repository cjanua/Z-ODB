import { useState, useCallback } from 'react'
import { runSync, type SyncProgress } from '@/lib/sync'

const DROPBOX_FOLDER = import.meta.env['VITE_DROPBOX_FOLDER'] as string || '/Apps/OBD Fusion'

export function useSync(onComplete?: () => void) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [syncing,  setSyncing]  = useState(false)

  const sync = useCallback(async () => {
    console.log('[sync] starting, folder:', DROPBOX_FOLDER)
    setSyncing(true)
    setProgress({ phase: 'listing', total: 0, completed: 0 })
    try {
      await runSync(DROPBOX_FOLDER, p => {
        console.log('[sync]', p.phase, p.completed, '/', p.total, p.error ?? '')
        setProgress(p)
        if (p.phase === 'done' || p.phase === 'error') {
          setSyncing(false)
          onComplete?.()
        }
      })
    } catch (e) {
      console.error('[sync] FAILED:', e)
      setSyncing(false)
    }
  }, [onComplete])

  return { progress, syncing, sync }
}
