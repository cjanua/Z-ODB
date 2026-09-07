import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { listSubfolders } from '@/lib/dropbox'
import { getSelectedVin, setSelectedVin, getBaseFolder } from '@/lib/vin'
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

  if (error || !vins?.length) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {error ? 'Could not load vehicles' : 'No vehicles found'}
      </p>
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
