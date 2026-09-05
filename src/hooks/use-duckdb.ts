import { useState, useEffect } from 'react'
import { initDuckDB, getManifest, type ManifestRow } from '@/lib/duckdb'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'

export function useDuckDB() {
  const [db,      setDb]      = useState<AsyncDuckDB | null>(null)
  const [ready,   setReady]   = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    initDuckDB()
      .then(instance => {
        if (!cancelled) { setDb(instance); setReady(true) }
      })
      .catch(e => {
        if (!cancelled) setError(String(e))
      })
    return () => { cancelled = true }
  }, [])

  return { db, ready, error }
}

export function useManifest() {
  const { ready } = useDuckDB()
  const [trips,   setTrips]   = useState<ManifestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    setLoading(true)
    getManifest()
      .then(rows => { setTrips(rows); setLoading(false) })
      .catch(e  => { setError(String(e)); setLoading(false) })
  }, [ready])

  const refresh = () => {
    setLoading(true)
    getManifest()
      .then(rows => { setTrips(rows); setLoading(false) })
      .catch(e  => { setError(String(e)); setLoading(false) })
  }

  return { trips, loading, error, refresh }
}
