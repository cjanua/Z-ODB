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
