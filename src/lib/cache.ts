/**
 * IndexedDB persistence layer.
 * Stores per-trip OBD Parquet blobs + metadata table Parquet snapshots
 * so DuckDB (which is in-memory) survives page reloads without re-syncing.
 */

const IDB_NAME    = 'z-obd-cache'
const IDB_VERSION = 1

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('obd_parquet'))
        db.createObjectStore('obd_parquet', { keyPath: 'trip_id' })
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror   = () => reject(req.error)
  })
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror   = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

function idbClearStore(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).clear()
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CachedOBD {
  trip_id: string
  parquet: Uint8Array
}

let _idb: IDBDatabase | null = null
async function db(): Promise<IDBDatabase> {
  return (_idb ??= await openIDB())
}

export async function saveOBDParquet(tripId: string, parquet: Uint8Array): Promise<void> {
  await idbPut(await db(), 'obd_parquet', { trip_id: tripId, parquet })
}

export async function loadAllOBDParquets(): Promise<CachedOBD[]> {
  return idbGetAll<CachedOBD>(await db(), 'obd_parquet')
}

export async function saveMetaParquet(key: string, parquet: Uint8Array): Promise<void> {
  await idbPut(await db(), 'meta', parquet, key)
}

export async function loadMetaParquet(key: string): Promise<Uint8Array | null> {
  const raw = await idbGet<Uint8Array>(await db(), 'meta', key)
  if (!raw || !(raw instanceof Uint8Array)) return null
  return raw
}

export async function clearCache(): Promise<void> {
  const d = await db()
  await idbClearStore(d, 'obd_parquet')
  await idbClearStore(d, 'meta')
}
