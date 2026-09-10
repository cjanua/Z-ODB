/**
 * SQL for the persistence layer, kept apart from the DuckDB module so it can be
 * exercised directly against a database without pulling in the browser-only
 * bindings around it.
 */

/**
 * Rebuild manifest rows for any trip whose OBD data is loaded but whose index
 * entry is missing. The manifest is cached as its own Parquet and can be lost
 * or fail to restore while the trip data survives; without this, those trips
 * would be present but invisible, and the app would look empty.
 *
 * Rows that already exist are left untouched, so a real ts_source is never
 * overwritten with 'recovered'.
 */
export const RECONCILE_MANIFEST_SQL = `
  INSERT INTO manifest BY NAME
  SELECT
    o.trip_id          AS trip_id,
    MIN(o.ts)          AS trip_ts,
    COUNT(*)::INTEGER  AS row_count,
    now()              AS synced_at,
    'recovered'        AS ts_source,
    false              AS is_fragment
  FROM obd o
  WHERE o.trip_id NOT IN (SELECT trip_id FROM manifest)
  GROUP BY o.trip_id
`
