import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  initDuckDB, getManifest, getTripSummaries, getTripSummary, getPulls, getAccelRuns,
  resetForRebuild,
  type ManifestRow, type TripSummary, type PullRecord, type AccelRun,
} from '@/lib/duckdb'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'

// ─── DuckDB ready state ───────────────────────────────────────────────────────

export function useDuckDB() {
  const [db,    setDb]    = useState<AsyncDuckDB | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    initDuckDB()
      .then(instance => { if (!cancelled) { setDb(instance); setReady(true) } })
      .catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [])

  return { db, ready, error }
}

// ─── Query keys (shared across all hook instances) ───────────────────────────

export const QUERY_KEYS = {
  manifest:      ['manifest']      as const,
  tripSummaries: ['trip_summaries'] as const,
  tripSummary:   (id: string) => ['trip_summary', id] as const,
  pulls:         (id?: string) => ['pulls', id ?? 'all'] as const,
  accelRuns:     (id?: string) => ['accel_runs', id ?? 'all'] as const,
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useManifest() {
  const { ready } = useDuckDB()
  const result = useQuery({
    queryKey: QUERY_KEYS.manifest,
    queryFn:  () => getManifest(),
    enabled:  ready,
    staleTime: 0,
  })
  return {
    trips:   result.data ?? ([] as ManifestRow[]),
    loading: result.isLoading,
    error:   result.error ? String(result.error) : null,
    refresh: () => result.refetch(),
  }
}

export function useTripSummaries(includeFragments = false) {
  const { ready } = useDuckDB()
  const result = useQuery({
    queryKey: [...QUERY_KEYS.tripSummaries, includeFragments],
    queryFn:  () => getTripSummaries(includeFragments),
    enabled:  ready,
    staleTime: 0,
  })
  return {
    summaries: result.data ?? ([] as TripSummary[]),
    loading:   result.isLoading,
    error:     result.error ? String(result.error) : null,
    refresh:   () => result.refetch(),
  }
}

/** Hook: rebuild — wipes all data, clears cursor, triggers a fresh full sync. */
export function useRebuild() {
  const qc = useQueryClient()
  return async () => {
    await resetForRebuild()
    qc.clear()
    localStorage.removeItem('dbx_list_cursor')
  }
}

export function useTripSummary(tripId: string) {
  const { ready } = useDuckDB()
  return useQuery({
    queryKey: QUERY_KEYS.tripSummary(tripId),
    queryFn:  () => getTripSummary(tripId),
    enabled:  ready && !!tripId,
    staleTime: 0,
  })
}

export function usePulls(tripId?: string) {
  const { ready } = useDuckDB()
  return useQuery({
    queryKey: QUERY_KEYS.pulls(tripId),
    queryFn:  () => getPulls(tripId),
    enabled:  ready,
    staleTime: 0,
  }) as { data: PullRecord[] | undefined; isLoading: boolean }
}

export function useAccelRuns(tripId?: string) {
  const { ready } = useDuckDB()
  return useQuery({
    queryKey: QUERY_KEYS.accelRuns(tripId),
    queryFn:  () => getAccelRuns(tripId),
    enabled:  ready,
    staleTime: 0,
  }) as { data: AccelRun[] | undefined; isLoading: boolean }
}

/** Call this after a sync completes to refresh all DuckDB-backed views. */
export function useInvalidateDuckDB() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.manifest })
    void qc.invalidateQueries({ queryKey: QUERY_KEYS.tripSummaries })
    void qc.invalidateQueries({ queryKey: ['trip_summary'] })
    void qc.invalidateQueries({ queryKey: ['pulls'] })
    void qc.invalidateQueries({ queryKey: ['accel_runs'] })
  }
}
