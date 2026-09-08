/**
 * Regressions for the "sync reports success but no trips appear" failure:
 *   1. downloadFile bypassed token refresh → every download 401'd after ~4h
 *   2. the list cursor advanced before ingest → failed files were never re-listed
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ─── localStorage stub (clearAllCursors uses .length / .key(i)) ──────────────

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null }
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, String(v)) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
}

const store = new MemStorage()
;(globalThis as Record<string, unknown>)['localStorage'] = store
;(globalThis as Record<string, unknown>)['sessionStorage'] = new MemStorage()

// ─── fetch stub ──────────────────────────────────────────────────────────────

interface Call { url: string; auth: string | undefined; body: string | undefined }
let calls: Call[] = []
type Handler = (c: Call) => { status: number; body: string }
let handler: Handler = () => ({ status: 200, body: '{}' })

;(globalThis as Record<string, unknown>)['fetch'] = async (
  url: string,
  init: { headers?: Record<string, string>; body?: unknown } = {},
) => {
  const call: Call = {
    url,
    auth: init.headers?.['Authorization'],
    body: typeof init.body === 'string' ? init.body : String(init.body ?? ''),
  }
  calls.push(call)
  const { status, body } = handler(call)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

const dbx = await import('./dropbox')

const FOLDER = '/Apps/OBD Fusion/CsvLogs/VIN123'

function authed({ expired = false } = {}) {
  store.clear()
  store.setItem('dbx_access_token',  'OLD_TOKEN')
  store.setItem('dbx_refresh_token', 'REFRESH')
  store.setItem('dbx_token_expiry',  String(Date.now() + (expired ? -60_000 : 3_600_000)))
}

const refreshResponse = JSON.stringify({
  access_token: 'NEW_TOKEN', refresh_token: 'REFRESH', expires_in: 14400,
})

beforeEach(() => { calls = [] })

// ─── Bug 1: content endpoint never refreshed its token ───────────────────────

describe('downloadFile auth', () => {
  test('refreshes an expired access token instead of 401ing', async () => {
    authed({ expired: true })
    handler = c => c.url.includes('oauth2/token')
      ? { status: 200, body: refreshResponse }
      : { status: 200, body: 'csv-contents' }

    const text = await dbx.downloadFile('/folder/CSVLog_20260905_173049.csv')

    expect(text).toBe('csv-contents')
    expect(calls[0]!.url).toContain('oauth2/token')
    const download = calls.find(c => c.url.includes('files/download'))!
    expect(download.auth).toBe('Bearer NEW_TOKEN')
  })

  test('retries once with a fresh token on a 401', async () => {
    authed()
    let seenDownloads = 0
    handler = c => {
      if (c.url.includes('oauth2/token')) return { status: 200, body: refreshResponse }
      seenDownloads++
      return seenDownloads === 1
        ? { status: 401, body: 'expired_access_token' }
        : { status: 200, body: 'csv-contents' }
    }

    expect(await dbx.downloadFile('/f/x.csv')).toBe('csv-contents')
    const downloads = calls.filter(c => c.url.includes('files/download'))
    expect(downloads.map(d => d.auth)).toEqual(['Bearer OLD_TOKEN', 'Bearer NEW_TOKEN'])
  })
})

// ─── Bug 2: cursor advanced before the files were ingested ───────────────────

describe('listing cursor', () => {
  test('listing alone does not persist the cursor', async () => {
    authed()
    handler = () => ({ status: 200, body: JSON.stringify({ entries: [], cursor: 'C1', has_more: false }) })

    const result = await dbx.listNewEntries(FOLDER)

    expect(result.cursor).toBe('C1')
    expect(result.full).toBe(true)
    expect(dbx.getStoredCursor(FOLDER)).toBeNull()
  })

  test('cursors are scoped per folder', async () => {
    authed()
    dbx.commitCursor(FOLDER, 'C1')
    expect(dbx.getStoredCursor(FOLDER)).toBe('C1')
    expect(dbx.getStoredCursor('/Apps/OBD Fusion/CsvLogs/OTHER_VIN')).toBeNull()
  })

  test('a rejected cursor falls back to a full listing, not an empty result', async () => {
    authed()
    dbx.commitCursor(FOLDER, 'STALE')
    handler = c => c.body?.includes('STALE')
      ? { status: 409, body: '{"error":{".tag":"reset"}}' }
      : {
          status: 200,
          body: JSON.stringify({
            entries: [{ '.tag': 'file', name: 'CSVLog_20260905_173049.csv', path_lower: '/a.csv' }],
            cursor: 'C2', has_more: false,
          }),
        }

    const result = await dbx.listNewEntries(FOLDER)

    expect(result.full).toBe(true)
    expect(result.entries).toHaveLength(1)
  })
})

// ─── The two together, through runSync ───────────────────────────────────────

const inserted: string[] = []
let insertShouldFail = false

mock.module('./duckdb', () => ({
  getManifestTripIds: async () => new Set(inserted),
  insertTrip: async (tripId: string) => {
    if (insertShouldFail) throw new Error('simulated insert failure')
    inserted.push(tripId)
  },
}))

const { runSync } = await import('./sync')

const CSV = [
  '# StartTime = 09/05/2026 05:30:49.0000 PM',
  'Time (sec),Engine RPM,Vehicle speed (mph)',
  '0.0,800,0',
  '0.5,1200,3',
].join('\n')

function listOneFile(cursor: string): Handler {
  return c => {
    if (c.url.includes('oauth2/token')) return { status: 200, body: refreshResponse }
    if (c.url.includes('files/download')) return { status: 200, body: CSV }
    return {
      status: 200,
      body: JSON.stringify({
        entries: [{ '.tag': 'file', name: 'CSVLog_20260905_173049.csv', path_lower: '/a.csv' }],
        cursor, has_more: false,
      }),
    }
  }
}

describe('runSync', () => {
  beforeEach(() => {
    authed()
    inserted.length = 0
    insertShouldFail = false
  })

  test('commits the cursor after a clean sync', async () => {
    handler = listOneFile('C_OK')
    const seen: string[] = []

    await runSync(FOLDER, p => seen.push(p.phase))

    expect(inserted).toEqual(['CSVLog_20260905_173049'])
    expect(seen.at(-1)).toBe('done')
    expect(dbx.getStoredCursor(FOLDER)).toBe('C_OK')
  })

  test('a failed insert leaves the cursor unset and reports an error', async () => {
    handler = listOneFile('C_BAD')
    insertShouldFail = true
    let last: { phase: string; error?: string } = { phase: '' }

    await runSync(FOLDER, p => { last = p })

    expect(inserted).toEqual([])
    expect(last.phase).toBe('error')
    expect(last.error).toContain('1 of 1 file failed')
    // The critical part: the file stays listable on the next sync.
    expect(dbx.getStoredCursor(FOLDER)).toBeNull()
  })

  test('the file comes back on the next sync after a failure', async () => {
    handler = listOneFile('C_BAD')
    insertShouldFail = true
    await runSync(FOLDER)
    expect(inserted).toEqual([])

    insertShouldFail = false
    handler = listOneFile('C_OK')
    await runSync(FOLDER)

    expect(inserted).toEqual(['CSVLog_20260905_173049'])
    expect(dbx.getStoredCursor(FOLDER)).toBe('C_OK')
  })

  test('a stale cursor with an empty manifest re-lists the folder in full', async () => {
    // Simulates the user's stuck state: cursor ahead of the data we actually hold.
    dbx.commitCursor(FOLDER, 'AHEAD')
    handler = c => {
      if (c.url.includes('oauth2/token')) return { status: 200, body: refreshResponse }
      if (c.url.includes('files/download')) return { status: 200, body: CSV }
      // The delta listing legitimately reports nothing new...
      if (c.body?.includes('AHEAD')) {
        return { status: 200, body: JSON.stringify({ entries: [], cursor: 'AHEAD', has_more: false }) }
      }
      // ...but the full listing still has the file.
      return {
        status: 200,
        body: JSON.stringify({
          entries: [{ '.tag': 'file', name: 'CSVLog_20260905_173049.csv', path_lower: '/a.csv' }],
          cursor: 'C_FULL', has_more: false,
        }),
      }
    }

    await runSync(FOLDER)

    expect(inserted).toEqual(['CSVLog_20260905_173049'])
    expect(dbx.getStoredCursor(FOLDER)).toBe('C_FULL')
  })
})

// ─── Misconfigured folder (base path instead of a vehicle folder) ────────────

describe('runSync folder diagnostics', () => {
  beforeEach(() => {
    authed()
    inserted.length = 0
    insertShouldFail = false
  })

  test('a folder of folders reports what is wrong, not "synced 0"', async () => {
    handler = c => {
      if (c.url.includes('oauth2/token')) return { status: 200, body: refreshResponse }
      return {
        status: 200,
        body: JSON.stringify({
          entries: [
            { '.tag': 'folder', name: 'CsvLogs', path_lower: '/apps/obd fusion/csvlogs' },
          ],
          cursor: 'C_DIRS', has_more: false,
        }),
      }
    }
    let last: { phase: string; error?: string } = { phase: '' }

    await runSync('/Apps/OBD Fusion', p => { last = p })

    expect(last.phase).toBe('error')
    expect(last.error).toContain('No CSVLog_*.csv files in /Apps/OBD Fusion')
    expect(last.error).toContain('CsvLogs')
    expect(dbx.getStoredCursor('/Apps/OBD Fusion')).toBeNull()
  })

  test('an empty vehicle folder is still a normal, successful sync', async () => {
    handler = c => {
      if (c.url.includes('oauth2/token')) return { status: 200, body: refreshResponse }
      return { status: 200, body: JSON.stringify({ entries: [], cursor: 'C_EMPTY', has_more: false }) }
    }
    let last: { phase: string } = { phase: '' }

    await runSync(FOLDER, p => { last = p })

    expect(last.phase).toBe('done')
    expect(dbx.getStoredCursor(FOLDER)).toBe('C_EMPTY')
  })
})

// ─── App-folder scoping ──────────────────────────────────────────────────────

const NOT_FOUND = JSON.stringify({
  error_summary: 'path/not_found/...',
  error: { '.tag': 'path', path: { '.tag': 'not_found' } },
})

function foldersBody(...names: string[]) {
  return JSON.stringify({
    entries: names.map(n => ({ '.tag': 'folder', name: n, path_lower: `/${n.toLowerCase()}` })),
    cursor: 'X', has_more: false,
  })
}

describe('appFolderRelativePath', () => {
  test('maps a full Dropbox path to its app-relative form', () => {
    expect(dbx.appFolderRelativePath('/Apps/OBD Fusion/CsvLogs')).toBe('/CsvLogs')
  })
  test('the app folder itself maps to API root', () => {
    expect(dbx.appFolderRelativePath('/Apps/OBD Fusion')).toBe('')
  })
  test('leaves a non-/Apps path alone', () => {
    expect(dbx.appFolderRelativePath('/OBD Fusion/CsvLogs')).toBeNull()
  })
})

describe('listSubfolders scoping', () => {
  const FULL = '/Apps/OBD Fusion/CsvLogs'

  beforeEach(() => { authed() })

  test('full-Dropbox app: uses the configured path as-is', async () => {
    handler = () => ({ status: 200, body: foldersBody('VIN_A', 'VIN_B') })

    expect(await dbx.listSubfolders(FULL)).toEqual(['VIN_A', 'VIN_B'])
    expect(dbx.getResolvedBase()).toBe(FULL)
  })

  test('app-folder app: falls back to the app-relative path and remembers it', async () => {
    handler = c => c.body?.includes('/Apps/OBD Fusion')
      ? { status: 409, body: NOT_FOUND }
      : { status: 200, body: foldersBody('VIN_A') }

    expect(await dbx.listSubfolders(FULL)).toEqual(['VIN_A'])
    expect(dbx.getResolvedBase()).toBe('/CsvLogs')

    // and the sync path is built from the resolved base
    const vin = await import('./vin')
    vin.setSelectedVin('VIN_A')
    expect(vin.getDropboxFolder()).toBe('/CsvLogs/VIN_A')
  })

  test('an auth error is not treated as a scoping problem', async () => {
    let listAttempts = 0
    handler = c => {
      if (c.url.includes('oauth2/token')) return { status: 200, body: refreshResponse }
      listAttempts++
      return { status: 403, body: 'missing_scope: files.metadata.read' }
    }

    await expect(dbx.listSubfolders(FULL)).rejects.toThrow('missing_scope')
    // No app-relative retry: the path was fine, the permissions were not.
    expect(listAttempts).toBe(1)
  })

  test('when both paths fail, the app-relative error surfaces', async () => {
    handler = c => c.body?.includes('/Apps/OBD Fusion')
      ? { status: 409, body: NOT_FOUND }
      : { status: 409, body: JSON.stringify({ error_summary: 'path/malformed_path/...' }) }

    await expect(dbx.listSubfolders(FULL)).rejects.toThrow('malformed_path')
  })
})
