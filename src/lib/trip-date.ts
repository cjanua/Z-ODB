/**
 * Single source of truth for trip timestamp derivation and formatting.
 *
 * OBD Fusion filenames encode local time: CSVLog_YYYYMMDD_HHMMSS.csv
 * We parse into a local Date, store as epoch ms, and display via toLocaleString.
 */

const FILENAME_RE = /CSVLog_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/

export function tripTsFromFilename(stem: string): Date {
  const m = stem.match(FILENAME_RE)
  if (!m) throw new Error(`Cannot parse trip timestamp from: ${stem}`)
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
  if (isNaN(d.getTime())) throw new Error(`Invalid date from: ${stem}`)
  return d
}

export function tripTsToEpochMs(d: Date): number {
  const ms = d.getTime()
  if (!isFinite(ms)) throw new Error(`Invalid Date cannot be stored`)
  return ms
}

export function epochMsToDate(ms: unknown): Date | null {
  if (ms == null) return null
  const n = typeof ms === 'bigint' ? Number(ms) : Number(ms)
  if (!isFinite(n) || n === 0) return null
  return new Date(n)
}

export function epochMsToDateOrFallback(ms: unknown, tripId: string): Date {
  const d = epochMsToDate(ms)
  if (d) return d
  try { return tripTsFromFilename(tripId) } catch { return new Date() }
}

export function formatTripDate(d: Date): string {
  if (isNaN(d.getTime())) return 'Invalid date'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
