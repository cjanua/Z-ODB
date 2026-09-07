import { useState, useCallback } from 'react'
import { runSync, type SyncProgress } from '@/lib/sync'
import { getDropboxFolder } from '@/lib/vin'

export function useSync(onComplete?: () => void) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [syncing,  setSyncing]  = useState(false)

  const sync = useCallback(async () => {
    const folder = getDropboxFolder()
    setSyncing(true)
    setProgress({ phase: 'listing', total: 0, completed: 0 })
    try {
      await runSync(folder, p => {
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
