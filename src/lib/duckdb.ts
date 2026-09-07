import * as duckdb from '@duckdb/duckdb-wasm'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { OBDRawRow } from './csv-parse'
import { tripTsToEpochMs, epochMsToDateOrFallback } from './trip-date'
import {
  clearCache, saveOBDParquet, loadAllOBDParquets,
  saveMetaParquet, loadMetaParquet,
} from './cache'

let _db: AsyncDuckDB | null = null
let _initPromise: Promise<AsyncDuckDB> | null = null

// ─── Init ─────────────────────────────────────────────────────────────────────

async function _doInit(): Promise<AsyncDuckDB> {
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }),
  )

  const worker = new Worker(workerUrl)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)

  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  URL.revokeObjectURL(workerUrl)

  const conn = await db.connect()
  await bootstrapSchema(conn)
  await restoreFromCache(conn, db)
  await conn.close()

  _db = db
  return db
}

export function initDuckDB(): Promise<AsyncDuckDB> {
  if (_db) return Promise.resolve(_db)
  _initPromise ??= _doInit()
  return _initPromise
}

export async function getDB(): Promise<AsyncDuckDB> {
  return _db ?? initDuckDB()
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function bootstrapSchema(conn: AsyncDuckDBConnection): Promise<void> {
  // Manifest (lightweight — trip existence + row count)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS manifest (
      trip_id    VARCHAR PRIMARY KEY,
      trip_ts    TIMESTAMP,
      row_count  INTEGER,
      synced_at  TIMESTAMP DEFAULT now(),
      ts_source  VARCHAR   DEFAULT 'filename',
      is_fragment BOOLEAN  DEFAULT false
    )
  `)
  await conn.query(`ALTER TABLE manifest ADD COLUMN IF NOT EXISTS ts_source   VARCHAR  DEFAULT 'filename'`)
  await conn.query(`ALTER TABLE manifest ADD COLUMN IF NOT EXISTS is_fragment BOOLEAN  DEFAULT false`)

  // Main OBD data table — all raw + derived columns
  await conn.query(`
    CREATE TABLE IF NOT EXISTS obd (
      -- identifiers
      trip_id     VARCHAR,
      t_rel       DOUBLE,
      ts          TIMESTAMP,
      -- raw channels
      load_pct         DOUBLE,
      coolant_f        DOUBLE,
      stft_b1          DOUBLE,
      ltft_b1          DOUBLE,
      stft_b2          DOUBLE,
      ltft_b2          DOUBLE,
      map_inhg         DOUBLE,
      rpm              DOUBLE,
      speed_mph        DOUBLE,
      timing_deg       DOUBLE,
      iat_f            DOUBLE,
      throttle_pct     DOUBLE,
      engine_runtime_s DOUBLE,
      fuel_level_pct   DOUBLE,
      baro_inhg        DOUBLE,
      lambda_cmd       DOUBLE,
      ambient_f        DOUBLE,
      pedal_pct        DOUBLE,
      oil_f            DOUBLE,
      maf_a            DOUBLE,
      maf_b            DOUBLE,
      rail_psi         DOUBLE,
      rail_cmd_psi     DOUBLE,
      cat_b1_f         DOUBLE,
      cat_b2_f         DOUBLE,
      fuel_sys_status  DOUBLE,
      turbo_a          DOUBLE,
      turbo_b          DOUBLE,
      fuel_lbmin       DOUBLE,
      odo_mi           DOUBLE,
      boost_psi        DOUBLE,
      lat              DOUBLE,
      lon              DOUBLE,
      alt_ft           DOUBLE,
      gps_mph          DOUBLE,
      gps_acc_ft       DOUBLE,
      volts            DOUBLE,
      pid_hz           DOUBLE,
      -- derived columns
      maf_total        DOUBLE,
      gear_ratio       DOUBLE,
      drive_state      VARCHAR,
      closed_loop      BOOLEAN,
      trim_total_b1    DOUBLE,
      trim_total_b2    DOUBLE,
      fuel_galhr       DOUBLE,
      mpg_inst         DOUBLE,
      mpg_rolling_30s  DOUBLE,
      hp_est           DOUBLE,
      turbo_ratio      DOUBLE,
      rail_residual    DOUBLE,
      accel_gps        DOUBLE,
      shift_window     BOOLEAN
    )
  `)
  await conn.query(`ALTER TABLE obd ADD COLUMN IF NOT EXISTS mpg_rolling_30s DOUBLE`)

  // Trip summary — one row per trip
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_summary (
      trip_id          VARCHAR PRIMARY KEY,
      ts_start         TIMESTAMP,
      duration_s       DOUBLE,
      miles            DOUBLE,
      fuel_gal         DOUBLE,
      mpg_trip         DOUBLE,
      dfco_pct         DOUBLE,
      idle_pct         DOUBLE,
      wot_s            DOUBLE,
      n_pulls          INTEGER,
      max_boost        DOUBLE,
      max_rpm          DOUBLE,
      max_turbo        DOUBLE,
      ltft_b1_med      DOUBLE,
      ltft_b2_med      DOUBLE,
      stft_iqr_b1      DOUBLE,
      stft_iqr_b2      DOUBLE,
      timing_wot_floor DOUBLE,
      oil_start_f      DOUBLE,
      t_to_oil_180s    DOUBLE,
      coolant_max      DOUBLE,
      ambient_med      DOUBLE,
      shutdown_volts   DOUBLE,
      volts_min        DOUBLE,
      gps_fix_s        DOUBLE,
      pid_hz_med       DOUBLE,
      frame_gap_max    DOUBLE,
      era_id           VARCHAR,
      fuel_level_start DOUBLE,
      fuel_level_end   DOUBLE,
      is_fragment      BOOLEAN DEFAULT false,
      avg_moving_mph   DOUBLE,
      accel_pct        DOUBLE
    )
  `)
  await conn.query(`ALTER TABLE trip_summary ADD COLUMN IF NOT EXISTS is_fragment    BOOLEAN DEFAULT false`)
  await conn.query(`ALTER TABLE trip_summary ADD COLUMN IF NOT EXISTS avg_moving_mph DOUBLE`)
  await conn.query(`ALTER TABLE trip_summary ADD COLUMN IF NOT EXISTS accel_pct      DOUBLE`)

  // Acceleration runs — 0-60 / 0-30 / 30-60 events
  await conn.query(`
    CREATE TABLE IF NOT EXISTS accel_runs (
      trip_id      VARCHAR,
      t_start      TIMESTAMP,
      t_rel_start  DOUBLE,
      t_0_30       DOUBLE,
      t_0_60       DOUBLE,
      t_30_60      DOUBLE,
      peak_speed   DOUBLE,
      era_id       VARCHAR DEFAULT 'stock'
    )
  `)

  // Pulls — one row per detected WOT pull
  await conn.query(`
    CREATE TABLE IF NOT EXISTS pulls (
      trip_id       VARCHAR,
      t_start       TIMESTAMP,
      t_rel_start   DOUBLE,
      duration_s    DOUBLE,
      rpm_min       DOUBLE,
      rpm_max       DOUBLE,
      peak_boost    DOUBLE,
      peak_maf      DOUBLE,
      hp_est_peak   DOUBLE,
      spool_0_10    DOUBLE,
      min_lambda    DOUBLE,
      timing_floor  DOUBLE,
      peak_turbo_a  DOUBLE,
      peak_turbo_b  DOUBLE,
      iat_start     DOUBLE,
      speed_start   DOUBLE,
      era_id        VARCHAR DEFAULT 'stock'
    )
  `)
}

// ─── Cache restore ────────────────────────────────────────────────────────────

const META_TABLES = ['manifest', 'trip_summary', 'pulls', 'accel_runs'] as const

async function restoreFromCache(conn: AsyncDuckDBConnection, db: AsyncDuckDB): Promise<void> {
  let restored = 0

  // 1. Per-trip OBD Parquet files
  const trips = await loadAllOBDParquets()
  for (const { trip_id, parquet } of trips) {
    try {
      const fname = `${trip_id}_restore.parquet`
      await db.registerFileBuffer(fname, parquet)
      await conn.query(`INSERT INTO obd SELECT * FROM read_parquet('${fname}')`)
      await db.dropFile(fname)
      restored++
    } catch (err) {
      console.warn(`[cache] skip trip ${trip_id}:`, err)
    }
  }

  // 2. Metadata tables — each independent, Parquet preserves types exactly
  for (const table of META_TABLES) {
    try {
      const buf = await loadMetaParquet(table)
      if (!buf) continue
      const fname = `${table}_restore.parquet`
      await db.registerFileBuffer(fname, buf)
      await conn.query(`INSERT INTO ${table} SELECT * FROM read_parquet('${fname}')`)
      await db.dropFile(fname)
      restored++
    } catch (err) {
      console.warn(`[cache] skip ${table}:`, err)
    }
  }

  // If nothing was restored, clear cursor so auto-sync does a full re-download
  if (restored === 0) {
    localStorage.removeItem('dbx_list_cursor')
  }
}

async function saveToCache(tripId: string, conn: AsyncDuckDBConnection, db: AsyncDuckDB): Promise<void> {
  try {
    const tid = tripId.replace(/'/g, "''")

    // Per-trip OBD data
    await conn.query(`COPY (SELECT * FROM obd WHERE trip_id = '${tid}') TO 'obd_export.parquet' (FORMAT PARQUET)`)
    const parquet = await db.copyFileToBuffer('obd_export.parquet')
    await db.dropFile('obd_export.parquet')
    await saveOBDParquet(tripId, parquet)

    // Metadata tables — Parquet preserves types exactly, no conversion needed
    for (const table of META_TABLES) {
      const count = await conn.query(`SELECT count(*) as n FROM ${table}`)
      if (Number(count.toArray()[0]?.['n'] ?? 0) === 0) continue
      const fname = `${table}_save.parquet`
      await conn.query(`COPY (SELECT * FROM ${table}) TO '${fname}' (FORMAT PARQUET)`)
      const buf = await db.copyFileToBuffer(fname)
      await db.dropFile(fname)
      await saveMetaParquet(table, buf)
    }
  } catch (err) {
    console.warn('[cache] save failed:', err)
  }
}

// ─── Insertion ────────────────────────────────────────────────────────────────

export async function insertTrip(
  tripId: string,
  tripTs: Date,
  rows: OBDRawRow[],
  shutdownVolts: number | null,
  ts_source: 'filename' | 'comment' = 'filename',
): Promise<void> {
  if (rows.length === 0) return

  const db   = await getDB()
  const conn = await db.connect()

  // Escape tripId for SQL
  const tid = tripId.replace(/'/g, "''")
  const sdv = shutdownVolts !== null ? String(shutdownVolts) : 'NULL'

  // Register raw rows as JSON
  await db.registerFileText(`${tripId}.json`, JSON.stringify(rows))

  // INSERT with full derived layer computed via SQL window functions
  await conn.query(`
    INSERT INTO obd
    WITH raw AS (
      SELECT
        trip_id::VARCHAR                             AS trip_id,
        t_rel::DOUBLE                                AS t_rel,
        ts_ms::DOUBLE                                AS ts_ms,
        TRY_CAST(load_pct         AS DOUBLE)         AS load_pct,
        TRY_CAST(coolant_f        AS DOUBLE)         AS coolant_f,
        TRY_CAST(stft_b1          AS DOUBLE)         AS stft_b1,
        TRY_CAST(ltft_b1          AS DOUBLE)         AS ltft_b1,
        TRY_CAST(stft_b2          AS DOUBLE)         AS stft_b2,
        TRY_CAST(ltft_b2          AS DOUBLE)         AS ltft_b2,
        TRY_CAST(map_inhg         AS DOUBLE)         AS map_inhg,
        TRY_CAST(rpm              AS DOUBLE)         AS rpm,
        TRY_CAST(speed_mph        AS DOUBLE)         AS speed_mph,
        TRY_CAST(timing_deg       AS DOUBLE)         AS timing_deg,
        TRY_CAST(iat_f            AS DOUBLE)         AS iat_f,
        TRY_CAST(throttle_pct     AS DOUBLE)         AS throttle_pct,
        TRY_CAST(engine_runtime_s AS DOUBLE)         AS engine_runtime_s,
        TRY_CAST(fuel_level_pct   AS DOUBLE)         AS fuel_level_pct,
        TRY_CAST(baro_inhg        AS DOUBLE)         AS baro_inhg,
        TRY_CAST(lambda_cmd       AS DOUBLE)         AS lambda_cmd,
        TRY_CAST(ambient_f        AS DOUBLE)         AS ambient_f,
        TRY_CAST(pedal_pct        AS DOUBLE)         AS pedal_pct,
        TRY_CAST(oil_f            AS DOUBLE)         AS oil_f,
        TRY_CAST(maf_a            AS DOUBLE)         AS maf_a,
        TRY_CAST(maf_b            AS DOUBLE)         AS maf_b,
        TRY_CAST(rail_psi         AS DOUBLE)         AS rail_psi,
        TRY_CAST(rail_cmd_psi     AS DOUBLE)         AS rail_cmd_psi,
        TRY_CAST(cat_b1_f         AS DOUBLE)         AS cat_b1_f,
        TRY_CAST(cat_b2_f         AS DOUBLE)         AS cat_b2_f,
        TRY_CAST(fuel_sys_status  AS DOUBLE)         AS fuel_sys_status,
        TRY_CAST(turbo_a          AS DOUBLE)         AS turbo_a,
        TRY_CAST(turbo_b          AS DOUBLE)         AS turbo_b,
        TRY_CAST(fuel_lbmin       AS DOUBLE)         AS fuel_lbmin,
        TRY_CAST(odo_mi           AS DOUBLE)         AS odo_mi,
        TRY_CAST(boost_psi        AS DOUBLE)         AS boost_psi,
        TRY_CAST(lat              AS DOUBLE)         AS lat,
        TRY_CAST(lon              AS DOUBLE)         AS lon,
        TRY_CAST(alt_ft           AS DOUBLE)         AS alt_ft,
        TRY_CAST(gps_mph          AS DOUBLE)         AS gps_mph,
        TRY_CAST(gps_acc_ft       AS DOUBLE)         AS gps_acc_ft,
        TRY_CAST(volts            AS DOUBLE)         AS volts,
        TRY_CAST(pid_hz           AS DOUBLE)         AS pid_hz
      FROM read_json_auto('${tripId}.json')
    ),
    lagged AS (
      SELECT *,
        rpm / NULLIF(speed_mph, 0)                        AS gear_ratio,
        LAG(rpm / NULLIF(speed_mph, 0), 1) OVER w        AS prev_gear_ratio,
        LAG(rpm,       1, rpm)             OVER w        AS prev_rpm,
        LAG(speed_mph, 1, speed_mph)       OVER w        AS prev_speed,
        LAG(gps_mph,   1, gps_mph)         OVER w        AS prev_gps_mph,
        LAG(t_rel,     1, t_rel)           OVER w        AS prev_t_rel
      FROM raw
      WINDOW w AS (ORDER BY t_rel)
    ),
    base AS (
      SELECT *,
        COALESCE(maf_a, 0) + COALESCE(maf_b, 0) AS maf_total,
        -- drive_state state machine
        CASE
          WHEN rpm = 0 OR rpm IS NULL                                      THEN 'OFF'
          WHEN rpm > 0 AND COALESCE(speed_mph, 0) < 2                     THEN 'IDLE'
          WHEN fuel_lbmin = 0 AND COALESCE(speed_mph, 0) >= 2             THEN 'DFCO'
          WHEN COALESCE(pedal_pct, 0) > 70 AND COALESCE(boost_psi, 0) > 3 THEN 'WOT'
          WHEN COALESCE(speed_mph, 0) > 0
            AND (speed_mph - COALESCE(prev_speed, speed_mph))
              / NULLIF(t_rel - COALESCE(prev_t_rel, t_rel), 0) > 2        THEN 'ACCEL'
          ELSE 'CRUISE'
        END AS drive_state,
        -- closed_loop: fuel_sys_status bit 2, fallback to lambda window
        CASE
          WHEN fuel_sys_status IS NOT NULL AND fuel_sys_status != 0
            THEN (CAST(CAST(fuel_sys_status AS INTEGER) & 2 AS INTEGER) = 2)
          ELSE (lambda_cmd IS NOT NULL AND lambda_cmd BETWEEN 0.97 AND 1.03)
        END AS closed_loop,
        -- shift detection: gear_ratio drop >12% when speed>10 (Phase 0.5)
        speed_mph > 10
          AND prev_gear_ratio IS NOT NULL
          AND ABS(gear_ratio - prev_gear_ratio) / NULLIF(ABS(prev_gear_ratio), 0) > 0.12
          AS shift_evt,
        fuel_lbmin * 60.0 / 6.07                AS fuel_galhr,
        (COALESCE(maf_a, 0) + COALESCE(maf_b, 0)) * 9.7 AS hp_est,
        CASE WHEN COALESCE(turbo_a, 0) > 5000
          THEN COALESCE(turbo_b, 0) / NULLIF(turbo_a, 0)
          ELSE NULL
        END AS turbo_ratio,
        CASE WHEN rail_psi IS NOT NULL AND rail_cmd_psi IS NOT NULL
          THEN rail_psi - rail_cmd_psi
          ELSE NULL
        END AS rail_residual,
        (COALESCE(gps_mph, 0) - COALESCE(prev_gps_mph, gps_mph))
          / NULLIF(t_rel - COALESCE(prev_t_rel, t_rel), 0) AS accel_gps_raw
      FROM lagged
    ),
    with_shift AS (
      SELECT *,
        shift_evt
          OR COALESCE(LAG(shift_evt,  1, false) OVER w, false)
          OR COALESCE(LAG(shift_evt,  2, false) OVER w, false)
          OR COALESCE(LEAD(shift_evt, 1, false) OVER w, false)
          OR COALESCE(LEAD(shift_evt, 2, false) OVER w, false) AS shift_window
      FROM base
      WINDOW w AS (ORDER BY t_rel)
    ),
    final AS (
      SELECT *,
        CASE WHEN closed_loop AND ABS(COALESCE(stft_b1, 0)) < 24
          THEN COALESCE(stft_b1, 0) + COALESCE(ltft_b1, 0) ELSE NULL
        END AS trim_total_b1,
        CASE WHEN closed_loop AND ABS(COALESCE(stft_b2, 0)) < 24
          THEN COALESCE(stft_b2, 0) + COALESCE(ltft_b2, 0) ELSE NULL
        END AS trim_total_b2,
        -- mpg_inst: valid only when moving, not DFCO, and fuel flow meaningful (Phase 0.6)
        CASE WHEN COALESCE(speed_mph, 0) > 5
          AND fuel_galhr > 0.3
          AND drive_state != 'DFCO'
          THEN speed_mph / fuel_galhr ELSE NULL
        END AS mpg_inst,
        -- mpg_rolling_30s: 30s trailing Σmi / Σgal, clamped at 60 (Phase 0.6)
        LEAST(60.0,
          SUM(speed_mph * (t_rel - prev_t_rel) / 3600.0) OVER (
            ORDER BY t_rel RANGE BETWEEN 30.0 PRECEDING AND CURRENT ROW
          ) / NULLIF(
            SUM(fuel_lbmin * (t_rel - prev_t_rel) / 60.0) OVER (
              ORDER BY t_rel RANGE BETWEEN 30.0 PRECEDING AND CURRENT ROW
            ) / 6.07, 0)
        ) AS mpg_rolling_30s,
        -- 3-frame smoothed GPS acceleration
        AVG(accel_gps_raw) OVER (
          ORDER BY t_rel ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
        ) AS accel_gps
      FROM with_shift
    )
    SELECT
      trip_id,
      t_rel,
      to_timestamp(ts_ms / 1000.0)::TIMESTAMP AS ts,
      load_pct, coolant_f, stft_b1, ltft_b1, stft_b2, ltft_b2,
      map_inhg, rpm, speed_mph, timing_deg, iat_f, throttle_pct,
      engine_runtime_s, fuel_level_pct, baro_inhg, lambda_cmd, ambient_f,
      pedal_pct, oil_f, maf_a, maf_b, rail_psi, rail_cmd_psi,
      cat_b1_f, cat_b2_f, fuel_sys_status, turbo_a, turbo_b, fuel_lbmin,
      odo_mi, boost_psi, lat, lon, alt_ft, gps_mph, gps_acc_ft, volts, pid_hz,
      maf_total, gear_ratio, drive_state, closed_loop,
      trim_total_b1, trim_total_b2, fuel_galhr, mpg_inst, mpg_rolling_30s, hp_est,
      turbo_ratio, rail_residual, accel_gps, shift_window
    FROM final
  `)

  await db.dropFile(`${tripId}.json`)

  // Compute and insert trip_summary
  await conn.query(`
    INSERT OR REPLACE INTO trip_summary
    WITH t AS (
      SELECT *,
        t_rel - LAG(t_rel, 1, t_rel) OVER (ORDER BY t_rel) AS dt
      FROM obd
      WHERE trip_id = '${tid}'
    ),
    odo_range AS (
      SELECT MAX(odo_mi) - MIN(odo_mi) AS odo_delta FROM t WHERE odo_mi IS NOT NULL
    )
    SELECT
      trip_id,
      MIN(ts)                                                AS ts_start,
      MAX(t_rel) - MIN(t_rel)                               AS duration_s,
      COALESCE(
        NULLIF((SELECT odo_delta FROM odo_range), 0),
        SUM(speed_mph * dt) / 3600.0
      )                                                     AS miles,
      SUM(fuel_lbmin * dt / 60.0) / 6.07                   AS fuel_gal,
      COALESCE(
        NULLIF((SELECT odo_delta FROM odo_range), 0),
        SUM(speed_mph * dt) / 3600.0
      ) / NULLIF(SUM(fuel_lbmin * dt / 60.0) / 6.07, 0)  AS mpg_trip,
      AVG(CASE WHEN drive_state = 'DFCO' THEN 1.0 ELSE 0.0 END) * 100 AS dfco_pct,
      AVG(CASE WHEN drive_state = 'IDLE' THEN 1.0 ELSE 0.0 END) * 100 AS idle_pct,
      SUM(CASE WHEN drive_state = 'WOT'  THEN dt  ELSE 0   END)       AS wot_s,
      0                                                     AS n_pulls,
      MAX(boost_psi)                                        AS max_boost,
      MAX(rpm)                                              AS max_rpm,
      MAX(GREATEST(COALESCE(turbo_a, 0), COALESCE(turbo_b, 0)))        AS max_turbo,
      MEDIAN(ltft_b1) FILTER (WHERE closed_loop)            AS ltft_b1_med,
      MEDIAN(ltft_b2) FILTER (WHERE closed_loop)            AS ltft_b2_med,
      QUANTILE_CONT(CASE WHEN closed_loop THEN stft_b1 END, 0.75)
        - QUANTILE_CONT(CASE WHEN closed_loop THEN stft_b1 END, 0.25)  AS stft_iqr_b1,
      QUANTILE_CONT(CASE WHEN closed_loop THEN stft_b2 END, 0.75)
        - QUANTILE_CONT(CASE WHEN closed_loop THEN stft_b2 END, 0.25)  AS stft_iqr_b2,
      MIN(timing_deg) FILTER (WHERE boost_psi > 5 AND pedal_pct > 50 AND NOT shift_window) AS timing_wot_floor,
      ARG_MIN(oil_f, t_rel)                                 AS oil_start_f,
      MIN(t_rel) FILTER (WHERE oil_f >= 180) - MIN(t_rel)  AS t_to_oil_180s,
      MAX(coolant_f)                                        AS coolant_max,
      MEDIAN(ambient_f)                                     AS ambient_med,
      ${sdv}                                                AS shutdown_volts,
      MIN(volts)                                            AS volts_min,
      MIN(t_rel) FILTER (WHERE lat IS NOT NULL) - MIN(t_rel) AS gps_fix_s,
      MEDIAN(pid_hz)                                        AS pid_hz_med,
      MAX(dt)                                               AS frame_gap_max,
      'stock'                                               AS era_id,
      ARG_MIN(fuel_level_pct, t_rel)                        AS fuel_level_start,
      ARG_MAX(fuel_level_pct, t_rel)                        AS fuel_level_end,
      -- fragment: too short or too little distance (Phase 0.2)
      (MAX(t_rel) - MIN(t_rel) < 60
        OR COALESCE(
          NULLIF((SELECT odo_delta FROM odo_range), 0),
          SUM(speed_mph * dt) / 3600.0
        ) < 0.2)                                            AS is_fragment,
      -- avg speed when moving (speed > 2 mph)
      SUM(speed_mph * dt) FILTER (WHERE speed_mph > 2.0)
        / NULLIF(SUM(dt) FILTER (WHERE speed_mph > 2.0), 0.0) AS avg_moving_mph,
      -- fraction of non-OFF time spent actively accelerating
      100.0 * SUM(dt) FILTER (WHERE drive_state = 'ACCEL')
        / NULLIF(SUM(dt) FILTER (WHERE drive_state != 'OFF'), 0.0) AS accel_pct
    FROM t
    GROUP BY trip_id
  `)

  // Pull detection: hysteresis state machine (Phase 0.3)
  // Enter: pedal>60 AND boost>3; Extend: boost>3; Exit: boost≤3 ×2 consecutive frames
  // Merge gaps < 2s; Valid: duration ≥ 1.5s AND rpm span ≥ 1200
  // Spool: interpolated 0→10 psi with 6s backward lookback (Phase 0.4)
  await conn.query(`
    INSERT INTO pulls
    WITH all_frames AS (
      SELECT *,
        boost_psi > 3 AS is_boost,
        -- hard exit = 2nd consecutive non-boost frame
        NOT (boost_psi > 3)
          AND NOT COALESCE(LAG(boost_psi > 3, 1) OVER (ORDER BY t_rel), TRUE)
          AS is_terminal
      FROM obd
      WHERE trip_id = '${tid}'
    ),
    segmented AS (
      SELECT *,
        SUM(CASE WHEN is_terminal THEN 1 ELSE 0 END) OVER (ORDER BY t_rel) AS seg_id
      FROM all_frames
    ),
    boost_segs AS (
      SELECT * FROM segmented WHERE is_boost
    ),
    seg_entry AS (
      SELECT seg_id, ARG_MIN(pedal_pct, t_rel) AS entry_pedal
      FROM boost_segs GROUP BY seg_id
    ),
    valid_boost AS (
      SELECT b.*
      FROM boost_segs b
      JOIN seg_entry e ON b.seg_id = e.seg_id AND e.entry_pedal > 60
    ),
    gapped AS (
      SELECT *, t_rel - LAG(t_rel, 1, 0.0) OVER (ORDER BY t_rel) AS gap_from_prev
      FROM valid_boost
    ),
    pull_groups AS (
      SELECT *,
        SUM(CASE WHEN gap_from_prev > 2.0 THEN 1 ELSE 0 END) OVER (ORDER BY t_rel) AS pull_grp
      FROM gapped
    ),
    -- Aggregate per pull (HAVING filters here)
    pull_agg AS (
      SELECT
        pull_grp,
        MIN(ts)                                               AS t_start,
        MIN(t_rel)                                            AS t_rel_start,
        MAX(t_rel) - MIN(t_rel)                               AS duration_s,
        MIN(rpm)                                              AS rpm_min,
        MAX(rpm)                                              AS rpm_max,
        MAX(boost_psi)                                        AS peak_boost,
        MAX(maf_total)                                        AS peak_maf,
        MAX(hp_est)                                           AS hp_est_peak,
        MIN(lambda_cmd)                                       AS min_lambda,
        MIN(timing_deg) FILTER (WHERE NOT shift_window)       AS timing_floor,
        MAX(turbo_a)                                          AS peak_turbo_a,
        MAX(turbo_b)                                          AS peak_turbo_b,
        ARG_MIN(iat_f,     t_rel)                             AS iat_start,
        ARG_MIN(speed_mph, t_rel)                             AS speed_start
      FROM pull_groups
      GROUP BY pull_grp
      HAVING MAX(t_rel) - MIN(t_rel) >= 1.5
        AND MAX(rpm) - MIN(rpm) >= 1200
    ),
    -- LEAD within each valid pull for 10 psi crossing interpolation
    pull_with_lead AS (
      SELECT pg.*,
        LEAD(t_rel,     1) OVER (PARTITION BY pull_grp ORDER BY t_rel) AS next_t,
        LEAD(boost_psi, 1) OVER (PARTITION BY pull_grp ORDER BY t_rel) AS next_boost
      FROM pull_groups pg
      WHERE pg.pull_grp IN (SELECT pull_grp FROM pull_agg)
    ),
    -- Interpolated first crossing of 10 psi per pull
    crossing AS (
      SELECT pull_grp,
        MIN(
          t_rel + (next_t - t_rel) * (10.0 - boost_psi) / NULLIF(next_boost - boost_psi, 0)
        ) FILTER (WHERE boost_psi < 10.0 AND COALESCE(next_boost, 0.0) >= 10.0) AS t_cross_10
      FROM pull_with_lead
      GROUP BY pull_grp
    ),
    -- Last boost≤0 frame in 6s window before each pull's entry (backward anchor)
    lookback AS (
      SELECT pa.pull_grp, MAX(o.t_rel) AS t_last_zero
      FROM pull_agg pa
      JOIN obd o ON o.trip_id = '${tid}'
        AND o.boost_psi <= 0
        AND o.t_rel < pa.t_rel_start
        AND o.t_rel >= pa.t_rel_start - 6.0
      GROUP BY pa.pull_grp
    )
    SELECT
      '${tid}'                                                AS trip_id,
      pa.t_start,
      pa.t_rel_start,
      pa.duration_s,
      pa.rpm_min,
      pa.rpm_max,
      pa.peak_boost,
      pa.peak_maf,
      pa.hp_est_peak,
      -- Spool: interpolated 10 psi crossing minus last ≤0 frame; NULL if no lookback or peak<10
      CASE WHEN pa.peak_boost >= 10.0 AND lb.t_last_zero IS NOT NULL AND c.t_cross_10 IS NOT NULL
        THEN c.t_cross_10 - lb.t_last_zero
        ELSE NULL
      END                                                    AS spool_0_10,
      pa.min_lambda,
      pa.timing_floor,
      pa.peak_turbo_a,
      pa.peak_turbo_b,
      pa.iat_start,
      pa.speed_start,
      'stock'                                                AS era_id
    FROM pull_agg pa
    LEFT JOIN crossing  c  USING (pull_grp)
    LEFT JOIN lookback lb  USING (pull_grp)
  `)

  // Update n_pulls in trip_summary
  await conn.query(`
    UPDATE trip_summary
    SET n_pulls = (SELECT COUNT(*) FROM pulls WHERE trip_id = '${tid}')
    WHERE trip_id = '${tid}'
  `)

  // Acceleration run detection: 0-60 / 0-30 / 30-60 mph
  // Uses GPS speed (prefer non-zero gps_mph, fall back to speed_mph)
  // Interpolated crossings at 5, 30, 60 mph; valid when < 30s and no near-stop mid-run
  await conn.query(`
    INSERT INTO accel_runs
    WITH frm AS (
      SELECT
        t_rel, ts,
        COALESCE(NULLIF(gps_mph, 0), speed_mph)                               AS v,
        LAG(COALESCE(NULLIF(gps_mph, 0), speed_mph), 1, 0.0) OVER (ORDER BY t_rel) AS v_prev,
        LAG(t_rel, 1, t_rel)                                  OVER (ORDER BY t_rel) AS t_prev
      FROM obd WHERE trip_id = '${tid}'
    ),
    -- Interpolated upward crossing times for 5, 30, 60 mph
    xings AS (
      SELECT
        t_rel, t_prev, ts, v, v_prev,
        CASE WHEN v_prev < 5  AND v >= 5  THEN t_prev + (t_rel - t_prev) * (5  - v_prev) / (v - v_prev) END AS tx5,
        CASE WHEN v_prev < 30 AND v >= 30 THEN t_prev + (t_rel - t_prev) * (30 - v_prev) / (v - v_prev) END AS tx30,
        CASE WHEN v_prev < 60 AND v >= 60 THEN t_prev + (t_rel - t_prev) * (60 - v_prev) / (v - v_prev) END AS tx60
      FROM frm
    ),
    -- Each 60 mph crossing event
    ev60 AS (
      SELECT tx60, t_rel AS trl60
      FROM xings WHERE tx60 IS NOT NULL
    ),
    -- Match to most recent 5 and 30 mph crossings within 30s before each 60 crossing
    runs AS (
      SELECT
        e.tx60, e.trl60,
        (SELECT MAX(x.tx5)  FROM xings x WHERE x.tx5  IS NOT NULL AND x.tx5  < e.tx60 AND x.tx5  >= e.tx60 - 30.0) AS tx5,
        (SELECT x.ts FROM xings x WHERE x.tx5 IS NOT NULL AND x.tx5 < e.tx60 AND x.tx5 >= e.tx60 - 30.0 ORDER BY x.tx5 DESC LIMIT 1) AS ts5,
        (SELECT MAX(x.tx30) FROM xings x WHERE x.tx30 IS NOT NULL AND x.tx30 < e.tx60 AND x.tx30 >= e.tx60 - 30.0) AS tx30
      FROM ev60 e
    ),
    valid AS (
      SELECT
        r.tx60, r.trl60, r.tx5, r.ts5, r.tx30,
        r.tx60 - r.tx5                                                         AS t_0_60,
        CASE WHEN r.tx30 IS NOT NULL THEN r.tx30  - r.tx5 ELSE NULL END        AS t_0_30,
        CASE WHEN r.tx30 IS NOT NULL THEN r.tx60  - r.tx30 ELSE NULL END       AS t_30_60,
        (SELECT MIN(f.v) FROM frm f WHERE f.t_rel BETWEEN r.tx5 AND r.trl60)  AS min_v,
        (SELECT MAX(f.v) FROM frm f WHERE f.t_rel BETWEEN r.tx5 AND r.trl60)  AS peak_v
      FROM runs r
      WHERE r.tx5 IS NOT NULL
        AND r.tx60 - r.tx5 < 30.0   -- must complete in under 30 s
    )
    SELECT
      '${tid}'  AS trip_id,
      ts5       AS t_start,
      tx5       AS t_rel_start,
      t_0_30,
      t_0_60,
      t_30_60,
      peak_v    AS peak_speed,
      'stock'   AS era_id
    FROM valid
    WHERE min_v >= 2.0   -- speed never near-stopped during the run
  `)

  // Upsert manifest (with ts_source + is_fragment from trip_summary)
  const tsEpoch = tripTsToEpochMs(tripTs)
  await conn.query(`
    INSERT OR REPLACE INTO manifest (trip_id, trip_ts, row_count, synced_at, ts_source, is_fragment)
    SELECT '${tid}', epoch_ms(${tsEpoch}::BIGINT), ${rows.length}, now(), '${ts_source}',
      COALESCE((SELECT is_fragment FROM trip_summary WHERE trip_id = '${tid}'), false)
  `)

  // Persist to IndexedDB cache
  await saveToCache(tripId, conn, db)

  await conn.close()
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

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
    SELECT trip_id, epoch_ms(trip_ts) AS trip_ts, row_count, epoch_ms(synced_at) AS synced_at
    FROM manifest
    ORDER BY trip_ts DESC
  `)
  await conn.close()
  return result.toArray().map((r: Record<string, unknown>) => ({
    trip_id:   String(r['trip_id']),
    trip_ts:   epochMsToDateOrFallback(r['trip_ts'], String(r['trip_id'])),
    row_count: Number(r['row_count']),
    synced_at: new Date(Number(r['synced_at'])),
  }))
}

/** Drop all computed data and cursor so the next sync is a full re-ingest. */
export async function resetForRebuild(): Promise<void> {
  const db   = await getDB()
  const conn = await db.connect()
  await conn.query(`DELETE FROM pulls`)
  await conn.query(`DELETE FROM accel_runs`)
  await conn.query(`DELETE FROM trip_summary`)
  await conn.query(`DELETE FROM manifest`)
  await conn.query(`DELETE FROM obd`)
  await conn.close()
  await clearCache()
  localStorage.removeItem('dbx_list_cursor')
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

// ─── Trip summary ─────────────────────────────────────────────────────────────

export interface TripSummary {
  trip_id:          string
  ts_start:         Date
  duration_s:       number
  miles:            number | null
  fuel_gal:         number | null
  mpg_trip:         number | null
  dfco_pct:         number
  idle_pct:         number
  wot_s:            number
  n_pulls:          number
  max_boost:        number | null
  max_rpm:          number | null
  max_turbo:        number | null
  ltft_b1_med:      number | null
  ltft_b2_med:      number | null
  stft_iqr_b1:      number | null
  stft_iqr_b2:      number | null
  timing_wot_floor: number | null
  oil_start_f:      number | null
  t_to_oil_180s:    number | null
  coolant_max:      number | null
  ambient_med:      number | null
  shutdown_volts:   number | null
  volts_min:        number | null
  gps_fix_s:        number | null
  pid_hz_med:       number | null
  frame_gap_max:    number | null
  era_id:           string
  fuel_level_start: number | null
  fuel_level_end:   number | null
  is_fragment:      boolean
  avg_moving_mph:   number | null
  accel_pct:        number | null
}

function rowToSummary(r: Record<string, unknown>): TripSummary {
  const n = (k: string) => r[k] != null ? Number(r[k]) : null
  return {
    trip_id:          String(r['trip_id']),
    ts_start:         epochMsToDateOrFallback(r['ts_start'], String(r['trip_id'])),
    duration_s:       Number(r['duration_s'] ?? 0),
    miles:            n('miles'),
    fuel_gal:         n('fuel_gal'),
    mpg_trip:         n('mpg_trip'),
    dfco_pct:         Number(r['dfco_pct'] ?? 0),
    idle_pct:         Number(r['idle_pct'] ?? 0),
    wot_s:            Number(r['wot_s'] ?? 0),
    n_pulls:          Number(r['n_pulls'] ?? 0),
    max_boost:        n('max_boost'),
    max_rpm:          n('max_rpm'),
    max_turbo:        n('max_turbo'),
    ltft_b1_med:      n('ltft_b1_med'),
    ltft_b2_med:      n('ltft_b2_med'),
    stft_iqr_b1:      n('stft_iqr_b1'),
    stft_iqr_b2:      n('stft_iqr_b2'),
    timing_wot_floor: n('timing_wot_floor'),
    oil_start_f:      n('oil_start_f'),
    t_to_oil_180s:    n('t_to_oil_180s'),
    coolant_max:      n('coolant_max'),
    ambient_med:      n('ambient_med'),
    shutdown_volts:   n('shutdown_volts'),
    volts_min:        n('volts_min'),
    gps_fix_s:        n('gps_fix_s'),
    pid_hz_med:       n('pid_hz_med'),
    frame_gap_max:    n('frame_gap_max'),
    era_id:           String(r['era_id'] ?? 'stock'),
    fuel_level_start: n('fuel_level_start'),
    fuel_level_end:   n('fuel_level_end'),
    is_fragment:      Boolean(r['is_fragment']),
    avg_moving_mph:   n('avg_moving_mph'),
    accel_pct:        n('accel_pct'),
  }
}

export async function getTripSummaries(includeFragments = false): Promise<TripSummary[]> {
  const db   = await getDB()
  const conn = await db.connect()
  const fragmentFilter = includeFragments ? '' : 'WHERE NOT COALESCE(is_fragment, false)'
  const result = await conn.query(`
    SELECT *, epoch_ms(ts_start) AS ts_start FROM trip_summary
    ${fragmentFilter}
    ORDER BY ts_start DESC
  `)
  await conn.close()
  return result.toArray().map(r => rowToSummary(r as Record<string, unknown>))
}

export async function getTripSummary(tripId: string): Promise<TripSummary | null> {
  const db   = await getDB()
  const conn = await db.connect()
  const result = await conn.query(`
    SELECT *, epoch_ms(ts_start) AS ts_start FROM trip_summary
    WHERE trip_id = '${tripId.replace(/'/g, "''")}'
    LIMIT 1
  `)
  await conn.close()
  const rows = result.toArray()
  return rows.length > 0 ? rowToSummary(rows[0] as Record<string, unknown>) : null
}

// ─── Pull records ─────────────────────────────────────────────────────────────

export interface PullRecord {
  trip_id:      string
  t_start:      Date
  t_rel_start:  number
  duration_s:   number
  rpm_min:      number | null
  rpm_max:      number | null
  peak_boost:   number | null
  peak_maf:     number | null
  hp_est_peak:  number | null
  spool_0_10:   number | null
  min_lambda:   number | null
  timing_floor: number | null
  peak_turbo_a: number | null
  peak_turbo_b: number | null
  era_id:       string
}

export async function getPulls(tripId?: string): Promise<PullRecord[]> {
  const db   = await getDB()
  const conn = await db.connect()
  const where = tripId ? `WHERE trip_id = '${tripId.replace(/'/g, "''")}'` : ''
  const result = await conn.query(`
    SELECT *, epoch_ms(t_start) AS t_start FROM pulls ${where} ORDER BY t_start DESC
  `)
  await conn.close()
  return result.toArray().map((r: Record<string, unknown>) => {
    const n = (k: string) => r[k] != null ? Number(r[k]) : null
    return {
      trip_id:      String(r['trip_id']),
      t_start:      epochMsToDateOrFallback(r['t_start'], String(r['trip_id'])),
      t_rel_start:  Number(r['t_rel_start'] ?? 0),
      duration_s:   Number(r['duration_s'] ?? 0),
      rpm_min:      n('rpm_min'),
      rpm_max:      n('rpm_max'),
      peak_boost:   n('peak_boost'),
      peak_maf:     n('peak_maf'),
      hp_est_peak:  n('hp_est_peak'),
      spool_0_10:   n('spool_0_10'),
      min_lambda:   n('min_lambda'),
      timing_floor: n('timing_floor'),
      peak_turbo_a: n('peak_turbo_a'),
      peak_turbo_b: n('peak_turbo_b'),
      era_id:       String(r['era_id'] ?? 'stock'),
    }
  })
}

// ─── Acceleration runs ────────────────────────────────────────────────────────

export interface AccelRun {
  trip_id:     string
  t_start:     Date
  t_rel_start: number
  t_0_30:      number | null
  t_0_60:      number | null
  t_30_60:     number | null
  peak_speed:  number | null
  era_id:      string
}

export async function getAccelRuns(tripId?: string): Promise<AccelRun[]> {
  const db   = await getDB()
  const conn = await db.connect()
  const where = tripId ? `WHERE trip_id = '${tripId.replace(/'/g, "''")}'` : ''
  const result = await conn.query(`
    SELECT *, epoch_ms(t_start) AS t_start FROM accel_runs ${where} ORDER BY t_start DESC
  `)
  await conn.close()
  return result.toArray().map((r: Record<string, unknown>) => {
    const n = (k: string) => r[k] != null ? Number(r[k]) : null
    return {
      trip_id:     String(r['trip_id']),
      t_start:     epochMsToDateOrFallback(r['t_start'], String(r['trip_id'])),
      t_rel_start: Number(r['t_rel_start'] ?? 0),
      t_0_30:      n('t_0_30'),
      t_0_60:      n('t_0_60'),
      t_30_60:     n('t_30_60'),
      peak_speed:  n('peak_speed'),
      era_id:      String(r['era_id'] ?? 'stock'),
    }
  })
}

// ─── Trip data (for charts) ───────────────────────────────────────────────────

export type OBDRow = {
  trip_id:     string
  t_rel:       number
  rpm:         number | null
  speed_mph:   number
  boost_psi:   number
  pedal_pct:   number | null
  throttle_pct: number | null
  stft_b1:     number | null
  ltft_b1:     number | null
  stft_b2:     number | null
  ltft_b2:     number | null
  coolant_f:   number | null
  oil_f:       number | null
  iat_f:       number | null
  ambient_f:   number | null
  timing_deg:  number | null
  turbo_a:     number | null
  turbo_b:     number | null
  maf_total:   number | null
  fuel_galhr:  number | null
  mpg_inst:    number | null
  drive_state: string | null
  trim_total_b1: number | null
  trim_total_b2: number | null
  lambda_cmd:  number | null
  load_pct:    number
  fuel_lbmin:  number
  hp_est:      number | null
}

export async function queryTripData(tripId: string): Promise<OBDRow[]> {
  const db   = await getDB()
  const conn = await db.connect()
  const result = await conn.query(`
    SELECT
      trip_id, t_rel, rpm, speed_mph, boost_psi, pedal_pct, throttle_pct,
      stft_b1, ltft_b1, stft_b2, ltft_b2,
      coolant_f, oil_f, iat_f, ambient_f, timing_deg,
      turbo_a, turbo_b, maf_total, fuel_galhr, mpg_inst,
      drive_state, trim_total_b1, trim_total_b2, lambda_cmd,
      load_pct, fuel_lbmin, hp_est
    FROM obd
    WHERE trip_id = '${tripId.replace(/'/g, "''")}'
    ORDER BY t_rel
  `)
  await conn.close()
  return result.toArray() as unknown as OBDRow[]
}
