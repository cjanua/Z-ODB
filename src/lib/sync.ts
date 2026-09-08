/**
 * Incremental sync pipeline:
 *   Dropbox list_folder/continue → filter new CSVs → parse → DuckDB insert
 */

import {
  listNewEntries, commitCursor, downloadFile,
  type DropboxEntry, type ListResult,
} from './dropbox'
import { parseOBDCsv, stemFromFilename } from './csv-parse'
import { insertTrip, getManifestTripIds } from './duckdb'

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

  let known: Set<string>
  let listing: ListResult
  let entries: DropboxEntry[]
  try {
    known   = await getManifestTripIds()
    listing = await listNewEntries(dropboxFolder)
    entries = listing.entries.filter(isCsvLog)

    // A delta listing that finds nothing while we hold no trips at all means the
    // stored cursor ran ahead of what we actually ingested (a failed or
    // interrupted earlier sync). Re-list the folder in full so those files come
    // back, instead of reporting "0 new" forever.
    if (!listing.full && entries.length === 0 && known.size === 0) {
      listing = await listNewEntries(dropboxFolder, { full: true })
      entries = listing.entries.filter(isCsvLog)
    }
  } catch (err) {
    onProgress({
      phase: 'error',
      total: 0,
      completed: 0,
      error: String(err),
    })
    throw err
  }

  // Filter to only new files not already in the manifest
  const toSync = entries.filter(e => !known.has(stemFromFilename(e.name)))

  const total = toSync.length
  let completed  = 0
  let failed     = 0
  let firstError: string | null = null

  const fail = (what: string, err: unknown) => {
    failed++
    firstError ??= `${what}: ${String(err)}`
    console.error(`[sync] ${what}:`, err)
  }

  for (const entry of toSync) {
    const tripId = stemFromFilename(entry.name)
    onProgress({ phase: 'downloading', total, completed, current: entry.name })

    let csvText: string
    try {
      csvText = await downloadFile(entry.path_lower)
    } catch (err) {
      fail(`Download failed for ${entry.name}`, err)
      continue
    }

    onProgress({ phase: 'inserting', total, completed, current: entry.name })

    try {
      const parsed = parseOBDCsv(csvText, tripId)
      await insertTrip(tripId, parsed.startTime, parsed.rows, parsed.shutdownVolts, parsed.ts_source)
      completed++
    } catch (err) {
      fail(`Insert failed for ${entry.name}`, err)
    }
  }

  // Advance the cursor only when every listed file made it in. Committing it
  // after a partial sync would hide the failed files permanently, since
  // list_folder/continue only returns changes made after the cursor.
  if (failed === 0) commitCursor(dropboxFolder, listing.cursor)

  if (failed > 0) {
    onProgress({
      phase: 'error',
      total,
      completed,
      error: `${failed} of ${total} file${total === 1 ? '' : 's'} failed — ${firstError}`,
    })
    return
  }

  onProgress({ phase: 'done', total, completed })
}
