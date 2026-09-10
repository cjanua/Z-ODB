/**
 * Exercises the persistence SQL against a real DuckDB — the reconciliation that
 * makes a lost manifest recoverable, and the delete-then-insert that makes a
 * re-ingest an upsert rather than a duplication.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import path from 'path'
import { createRequire } from 'module'
import { RECONCILE_MANIFEST_SQL } from './persistence-sql'

const require = createRequire(import.meta.url)
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')

const DIST = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
const bundle = {
  mainModule: path.resolve(DIST, './duckdb-eh.wasm'),
  mainWorker: path.resolve(DIST, './duckdb-node-eh.worker.cjs'),
}

const db = await duckdb.createDuckDB(
  { mvp: bundle, eh: bundle }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME,
)
await db.instantiate(() => {})
const conn = db.connect()

// The columns the persistence SQL actually touches.
function freshSchema() {
  conn.query(`DROP TABLE IF EXISTS obd`)
  conn.query(`DROP TABLE IF EXISTS manifest`)
  conn.query(`DROP TABLE IF EXISTS pulls`)
  conn.query(`
    CREATE TABLE manifest (
      trip_id     VARCHAR PRIMARY KEY,
      trip_ts     TIMESTAMP,
      row_count   INTEGER,
      synced_at   TIMESTAMP DEFAULT now(),
      ts_source   VARCHAR   DEFAULT 'filename',
      is_fragment BOOLEAN   DEFAULT false
    )`)
  conn.query(`CREATE TABLE obd (trip_id VARCHAR, t_rel DOUBLE, ts TIMESTAMP, rpm DOUBLE)`)
  conn.query(`CREATE TABLE pulls (trip_id VARCHAR, t_start DOUBLE)`)
}

function addTrip(id: string, rows: number, startMs: number) {
  for (let i = 0; i < rows; i++) {
    conn.query(
      `INSERT INTO obd VALUES ('${id}', ${i * 0.5}, epoch_ms(${startMs + i * 500}::BIGINT), ${1000 + i})`,
    )
  }
}

const manifestRows = () =>
  conn.query(`SELECT trip_id, row_count, ts_source FROM manifest ORDER BY trip_id`)
    .toArray().map(r => r.toJSON() as { trip_id: string; row_count: number; ts_source: string })

const countIn = (table: string, id: string) =>
  Number(conn.query(`SELECT count(*) n FROM ${table} WHERE trip_id = '${id}'`).toArray()[0].n)

beforeEach(freshSchema)

describe('manifest reconciliation', () => {
  test('rebuilds index rows for trips whose data survived without one', () => {
    addTrip('CSVLog_20260905_173049', 4, 1_757_000_000_000)
    addTrip('CSVLog_20260906_081500', 2, 1_757_090_000_000)
    // Only one trip has an index entry — the manifest Parquet failed to restore.
    conn.query(`INSERT INTO manifest VALUES
      ('CSVLog_20260905_173049', epoch_ms(1757000000000::BIGINT), 4, now(), 'filename', false)`)

    conn.query(RECONCILE_MANIFEST_SQL)

    expect(manifestRows()).toEqual([
      { trip_id: 'CSVLog_20260905_173049', row_count: 4, ts_source: 'filename' },
      { trip_id: 'CSVLog_20260906_081500', row_count: 2, ts_source: 'recovered' },
    ])
  })

  test('a wholly lost manifest is rebuilt from the data alone', () => {
    addTrip('CSVLog_20260905_173049', 3, 1_757_000_000_000)
    addTrip('CSVLog_20260906_081500', 5, 1_757_090_000_000)

    conn.query(RECONCILE_MANIFEST_SQL)

    expect(manifestRows().map(r => r.trip_id)).toEqual([
      'CSVLog_20260905_173049', 'CSVLog_20260906_081500',
    ])
  })

  test('does not disturb rows that are already correct', () => {
    addTrip('CSVLog_20260905_173049', 4, 1_757_000_000_000)
    conn.query(`INSERT INTO manifest VALUES
      ('CSVLog_20260905_173049', epoch_ms(1757000000000::BIGINT), 4, now(), 'comment', true)`)

    conn.query(RECONCILE_MANIFEST_SQL)

    const [row] = manifestRows()
    expect(row!.ts_source).toBe('comment')  // not overwritten with 'recovered'
    expect(manifestRows()).toHaveLength(1)
  })

  test('recovered row_count and trip_ts match the data', () => {
    addTrip('CSVLog_20260905_173049', 7, 1_757_000_000_000)

    conn.query(RECONCILE_MANIFEST_SQL)

    const r = conn.query(
      `SELECT row_count, epoch_ms(trip_ts) AS ms FROM manifest`,
    ).toArray()[0].toJSON() as { row_count: number; ms: bigint | number }
    expect(r.row_count).toBe(7)
    expect(Number(r.ms)).toBe(1_757_000_000_000)
  })

  test('an empty store reconciles to an empty manifest', () => {
    conn.query(RECONCILE_MANIFEST_SQL)
    expect(manifestRows()).toEqual([])
  })
})

describe('re-ingest is an upsert', () => {
  const ID = 'CSVLog_20260905_173049'

  test('re-ingesting a trip replaces its rows instead of duplicating them', () => {
    addTrip(ID, 4, 1_757_000_000_000)
    conn.query(`INSERT INTO pulls VALUES ('${ID}', 1.5)`)
    expect(countIn('obd', ID)).toBe(4)

    // What insertTrip now does before re-inserting.
    conn.query(`DELETE FROM obd   WHERE trip_id = '${ID}'`)
    conn.query(`DELETE FROM pulls WHERE trip_id = '${ID}'`)
    addTrip(ID, 4, 1_757_000_000_000)
    conn.query(`INSERT INTO pulls VALUES ('${ID}', 1.5)`)

    expect(countIn('obd', ID)).toBe(4)
    expect(countIn('pulls', ID)).toBe(1)
  })

  test('without the delete, rows accumulate — the bug this prevents', () => {
    addTrip(ID, 4, 1_757_000_000_000)
    addTrip(ID, 4, 1_757_000_000_000)
    expect(countIn('obd', ID)).toBe(8)
  })

  test('re-ingesting one trip leaves the others alone', () => {
    addTrip(ID, 4, 1_757_000_000_000)
    addTrip('CSVLog_20260906_081500', 3, 1_757_090_000_000)

    conn.query(`DELETE FROM obd WHERE trip_id = '${ID}'`)
    addTrip(ID, 5, 1_757_000_000_000)

    expect(countIn('obd', ID)).toBe(5)
    expect(countIn('obd', 'CSVLog_20260906_081500')).toBe(3)
  })
})
