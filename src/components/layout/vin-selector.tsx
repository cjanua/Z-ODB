import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { listSubfolders } from '@/lib/dropbox'
import { getSelectedVin, setSelectedVin, getBaseFolder, getConfiguredBaseFolder } from '@/lib/vin'
import { appFolderRelativePath, RECONNECT_MSG, startOAuthFlow } from '@/lib/dropbox'
import { useState } from 'react'

export function VinSelector({ onSwitch }: { onSwitch?: () => void }) {
  const [selected, setSelected] = useState(getSelectedVin)
  const { data: vins, isLoading, error } = useQuery({
    queryKey: ['dropbox-vins'],
    queryFn: () => listSubfolders(getBaseFolder()),
    staleTime: 10 * 60_000,
    retry: 2,
  })

  useEffect(() => {
    if (vins?.length === 1 && !selected) {
      setSelectedVin(vins[0]!)
      setSelected(vins[0]!)
      onSwitch?.()
    }
  }, [vins, selected, onSwitch])

  function handleChange(vin: string) {
    setSelectedVin(vin)
    setSelected(vin)
    onSwitch?.()
  }

  if (isLoading) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading vehicles…</p>
  }

  // Surface the real Dropbox error and the path we tried — a bare "could not
  // load" hides path/not_found, missing_scope and expired-token equally.
  if (error) {
    // An expired/revoked credential is not a folder problem — it needs a new
    // OAuth round trip, so offer that instead of a path to stare at.
    if (String(error).includes(RECONNECT_MSG)) {
      return (
        <div className="px-3 py-2 space-y-2">
          <p className="text-xs text-red-400">{RECONNECT_MSG}</p>
          <button
            onClick={() => void startOAuthFlow()}
            className="w-full rounded-md border px-2 py-1.5 text-xs hover:bg-accent transition-colors"
          >
            Reconnect Dropbox
          </button>
        </div>
      )
    }

    return (
      <div className="px-3 py-2 space-y-1">
        <p className="text-xs text-red-400">Could not load vehicles</p>
        <p className="text-[10px] text-muted-foreground break-all" title={String(error)}>
          {String(error)}
        </p>
        <p className="text-[10px] text-muted-foreground break-all">
          Tried: <span className="font-mono">{getConfiguredBaseFolder()}</span>
          {appFolderRelativePath(getConfiguredBaseFolder()) !== null && (
            <> and <span className="font-mono">
              {appFolderRelativePath(getConfiguredBaseFolder()) || '/'}
            </span></>
          )}
        </p>
      </div>
    )
  }

  if (!vins?.length) {
    return (
      <div className="px-3 py-2 space-y-1">
        <p className="text-xs text-muted-foreground">No vehicles found</p>
        <p className="text-[10px] text-muted-foreground break-all">
          No subfolders in <span className="font-mono">{getBaseFolder()}</span>
        </p>
      </div>
    )
  }

  if (vins.length === 1) {
    return (
      <div className="px-3 py-2">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle</label>
        <p className="text-xs font-medium mt-0.5 truncate" title={vins[0]}>{vins[0]}</p>
      </div>
    )
  }

  return (
    <div className="px-2 py-2">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">Vehicle</label>
      <select
        value={selected ?? ''}
        onChange={e => handleChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {!selected && <option value="">Select VIN…</option>}
        {vins.map(vin => (
          <option key={vin} value={vin}>
            {vin.length > 17 ? vin.slice(0, 17) : vin}
          </option>
        ))}
      </select>
    </div>
  )
}
