/**
 * Incremental sync pipeline:
 *   Dropbox list_folder/continue → filter new CSVs → parse → DuckDB insert
 */

import { listNewEntries, downloadFile, type DropboxEntry } from './dropbox'
import { parseOBDCsv, stemFromFilename } from './csv-parse'
import { insertTrip, hasTripInManifest } from './duckdb'

const CSV_LOG_PATTERN = /^CSVLog_\d{8}_\d{6}\.csv$/i

export interface SyncProgress {
  phase:     'listing' | 'downloading' | 'inserting' | 'done' | 'error'
  total:     number
  completed: number
  current?:  string
  error?:    string
}

export type SyncProgressCallback = (p: SyncProgress) => void

function isCsvLog(entry: DropboxEntry): boolean {
  return entry['.tag'] === 'file' && CSV_LOG_PATTERN.test(entry.name)
}

/** Run a full incremental sync from Dropbox into DuckDB. */
export async function runSync(
  dropboxFolder: string,
  onProgress: SyncProgressCallback = () => {},
): Promise<void> {
  onProgress({ phase: 'listing', total: 0, completed: 0 })

  let entries: DropboxEntry[]
  try {
    const result = await listNewEntries(dropboxFolder)
    entries = result.entries.filter(isCsvLog)
  } catch (err) {
    onProgress({
      phase: 'error',
      total: 0,
      completed: 0,
      error: String(err),
    })
    throw err
  }

  // Filter to only new files not already in manifest
  const toSync: DropboxEntry[] = []
  for (const entry of entries) {
    const tripId = stemFromFilename(entry.name)
    const already = await hasTripInManifest(tripId)
    if (!already) toSync.push(entry)
  }

  const total = toSync.length
  let completed = 0

  for (const entry of toSync) {
    const tripId = stemFromFilename(entry.name)
    onProgress({ phase: 'downloading', total, completed, current: entry.name })

    let csvText: string
    try {
      csvText = await downloadFile(entry.path_lower)
    } catch (err) {
      console.error(`Failed to download ${entry.name}:`, err)
      completed++
      continue
    }

    onProgress({ phase: 'inserting', total, completed, current: entry.name })

    try {
      const parsed = parseOBDCsv(csvText, tripId)
      await insertTrip(tripId, parsed.startTime, parsed.rows, parsed.shutdownVolts, parsed.ts_source)
    } catch (err) {
      console.error(`Failed to insert ${entry.name}:`, err)
    }

    completed++
  }

  onProgress({ phase: 'done', total, completed })
}
