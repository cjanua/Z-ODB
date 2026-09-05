import * as duckdb from '@duckdb/duckdb-wasm'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { OBDRow } from './csv-parse'

let _db: AsyncDuckDB | null = null

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initDuckDB(): Promise<AsyncDuckDB> {
  if (_db) return _db

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)

  // Spawn worker from CDN blob (avoids CORS issues with bundled WASM workers)
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], {
      type: 'text/javascript',
    }),
  )

  const worker = new Worker(workerUrl)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)

  _db = new duckdb.AsyncDuckDB(logger, worker)
  await _db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  URL.revokeObjectURL(workerUrl)

  // Bootstrap schema
  const conn = await _db.connect()
  await bootstrapSchema(conn)
  await conn.close()

  return _db
}

export async function getDB(): Promise<AsyncDuckDB> {
  return _db ?? initDuckDB()
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function bootstrapSchema(conn: AsyncDuckDBConnection): Promise<void> {
  // Trip manifest
  await conn.query(`
    CREATE TABLE IF NOT EXISTS manifest (
      trip_id   TEXT PRIMARY KEY,
      trip_ts   TIMESTAMP,
      row_count INTEGER,
      synced_at TIMESTAMP DEFAULT now()
    )
  `)

  // OBD data table
  await conn.query(`
    CREATE TABLE IF NOT EXISTS obd (
      trip_id          TEXT,
      time_sec         DOUBLE,
      rpm              DOUBLE,
      speed_mph        DOUBLE,
      coolant_temp_f   DOUBLE,
      throttle_pct     DOUBLE,
      stft_b1_pct      DOUBLE,
      ltft_b1_pct      DOUBLE,
      stft_b2_pct      DOUBLE,
      ltft_b2_pct      DOUBLE,
      boost_psi        DOUBLE,
      map_inhg         DOUBLE,
      maf_a_lb_min     DOUBLE,
      fuel_rate_lb_min DOUBLE,
      accel_pedal_pct  DOUBLE,
      oil_temp_f       DOUBLE,
      iat_f            DOUBLE,
      latitude         DOUBLE,
      longitude        DOUBLE,
      altitude_ft      DOUBLE,
      gps_speed_mph    DOUBLE,
      voltage_v        DOUBLE
    )
  `)
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────

export interface ManifestRow {
  trip_id:   string
  trip_ts:   Date
  row_count: number
  synced_at: Date
}

export async function getManifest(): Promise<ManifestRow[]> {
  const db   = await getDB()
  const conn = await db.connect()
  const result = await conn.query(`
    SELECT trip_id, trip_ts::TEXT as trip_ts, row_count, synced_at::TEXT as synced_at
    FROM manifest
    ORDER BY trip_ts DESC
  `)
  await conn.close()

  return result.toArray().map((r: Record<string, unknown>) => ({
    trip_id:   String(r['trip_id']),
    trip_ts:   new Date(String(r['trip_ts'])),
    row_count: Number(r['row_count']),
    synced_at: new Date(String(r['synced_at'])),
  }))
}

export async function hasTripInManifest(tripId: string): Promise<boolean> {
  const db   = await getDB()
  const conn = await db.connect()
  const result = await conn.query(
    `SELECT 1 FROM manifest WHERE trip_id = '${tripId.replace(/'/g, "''")}' LIMIT 1`,
  )
  await conn.close()
  return result.toArray().length > 0
}

// ─── Data insertion ───────────────────────────────────────────────────────────

export async function insertTrip(
  tripId: string,
  tripTs: Date,
  rows: OBDRow[],
): Promise<void> {
  if (rows.length === 0) return

  const db   = await getDB()
  const conn = await db.connect()

  // Insert OBD rows using DuckDB's columnar insert
  await db.registerFileText(`${tripId}.json`, JSON.stringify(rows))
  await conn.query(`
    INSERT INTO obd
    SELECT * FROM read_json_auto('${tripId}.json')
  `)
  await db.dropFile(`${tripId}.json`)

  // Update manifest
  const ts = tripTs.toISOString().replace('T', ' ').replace('Z', '')
  await conn.query(`
    INSERT OR REPLACE INTO manifest (trip_id, trip_ts, row_count, synced_at)
    VALUES ('${tripId}', TIMESTAMP '${ts}', ${rows.length}, now())
  `)

  await conn.close()
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function queryTripData(tripId: string): Promise<OBDRow[]> {
  const db   = await getDB()
  const conn = await db.connect()
  const result = await conn.query(
    `SELECT * FROM obd WHERE trip_id = '${tripId.replace(/'/g, "''")}' ORDER BY time_sec`,
  )
  await conn.close()
  return result.toArray() as unknown as OBDRow[]
}

export async function queryTripStats(tripId: string) {
  const db   = await getDB()
  const conn = await db.connect()
  const result = await conn.query(`
    SELECT
      max(rpm)          as peak_rpm,
      max(speed_mph)    as peak_speed,
      max(boost_psi)    as peak_boost,
      avg(boost_psi)    as avg_boost,
      max(time_sec)     as duration_sec,
      max(coolant_temp_f) as peak_coolant
    FROM obd
    WHERE trip_id = '${tripId.replace(/'/g, "''")}'
  `)
  await conn.close()
  const row = result.toArray()[0] as Record<string, unknown>
  return {
    peakRpm:      Number(row?.['peak_rpm'] ?? 0),
    peakSpeed:    Number(row?.['peak_speed'] ?? 0),
    peakBoost:    Number(row?.['peak_boost'] ?? 0),
    avgBoost:     Number(row?.['avg_boost'] ?? 0),
    durationSec:  Number(row?.['duration_sec'] ?? 0),
    peakCoolant:  Number(row?.['peak_coolant'] ?? 0),
  }
}
