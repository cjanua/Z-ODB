/**
 * OBD Fusion CSV format:
 *   Line 0: # StartTime = MM/DD/YYYY HH:MM:SS.ssss AM/PM
 *   Line 1: column headers
 *   Lines 2+: data rows
 */

/** All raw OBD channels in canonical snake_case (per spec). */
export interface OBDRawRow {
  trip_id:          string
  t_rel:            number    // elapsed seconds
  ts_ms:            number    // epoch ms = startTime + t_rel*1000
  load_pct:         number    // 0 is real
  coolant_f:        number | null
  stft_b1:          number | null
  ltft_b1:          number | null
  stft_b2:          number | null
  ltft_b2:          number | null
  map_inhg:         number | null
  rpm:              number    // 0 = engine off (real)
  speed_mph:        number    // 0 is real
  timing_deg:       number | null
  iat_f:            number | null   // NULL when 0 (dead channel)
  throttle_pct:     number | null
  engine_runtime_s: number | null
  fuel_level_pct:   number | null
  baro_inhg:        number | null
  lambda_cmd:       number | null   // 0 = fuel cut (real — kept as-is)
  ambient_f:        number | null
  pedal_pct:        number | null
  oil_f:            number | null
  maf_a:            number | null
  maf_b:            number | null
  rail_psi:         number | null   // converted from inHg × 0.4912 at parse
  rail_cmd_psi:     number | null   // converted from inHg × 0.4912 at parse
  cat_b1_f:         number | null   // NULL when 0
  cat_b2_f:         number | null   // NULL when 0
  fuel_sys_status:  number | null
  turbo_a:          number | null
  turbo_b:          number | null
  fuel_lbmin:       number    // 0 = DFCO (real)
  odo_mi:           number | null
  boost_psi:        number    // 0 is real (app-computed map−baro)
  lat:              number | null   // NULL when 0 (no GPS fix)
  lon:              number | null   // NULL when 0
  alt_ft:           number | null   // NULL when 0
  gps_mph:          number    // 0 is real
  gps_acc_ft:       number | null   // NULL when 0
  volts:            number | null
  pid_hz:           number | null
}

export interface ParseResult {
  startTime:     Date
  ts_source:     'filename' | 'comment'
  shutdownVolts: number | null   // from last engine-off frames before trim
  rows:          OBDRawRow[]
}

// ─── Column name matching ─────────────────────────────────────────────────────

/** Returns first header that case-insensitively contains any candidate substring. */
function findCol(headers: string[], ...candidates: string[]): string | undefined {
  for (const cand of candidates) {
    const lower = cand.toLowerCase()
    const found = headers.find(h => h.toLowerCase().includes(lower))
    if (found) return found
  }
  return undefined
}

// ─── Timestamp parsing ───────────────────────────────────────────────────────

export function deriveTripTs(stem: string): Date {
  const m = stem.match(/CSVLog_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (!m) throw new Error(`Cannot parse timestamp from: ${stem}`)
  // OBD Fusion writes local time in the filename — use local Date constructor
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
}

export function stemFromFilename(filename: string): string {
  return filename.replace(/\.csv$/i, '').replace(/^.*\//, '')
}

/**
 * Parse the OBD Fusion StartTime comment line:
 *   # StartTime = MM/DD/YYYY HH:MM:SS.ssss AM/PM
 * Strips leading BOM (\uFEFF) before matching.
 * Returns null if line is missing or malformed.
 */
function parseStartTime(line: string): Date | null {
  const stripped = line.replace(/^\uFEFF/, '')
  const m = stripped.match(
    /^#\s*StartTime\s*=\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(AM|PM)/i
  )
  if (!m) return null
  let [, mo, dy, yr, hr, mn, sc, ampm] = m
  let h = parseInt(hr!, 10)
  if (ampm!.toUpperCase() === 'AM' && h === 12) h = 0
  if (ampm!.toUpperCase() === 'PM' && h !== 12) h += 12
  // OBD Fusion StartTime is also local — use local Date constructor
  const d = new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    h,
    parseInt(mn!, 10),
    parseInt(sc!, 10),
  )
  return isNaN(d.getTime()) ? null : d
}

// ─── Numeric helpers ─────────────────────────────────────────────────────────

/** Parse float; return 0 if missing/NaN (for "0 is real" columns). */
function num(raw: Record<string, string>, key: string | undefined): number {
  if (!key) return 0
  const v = parseFloat(raw[key] ?? '')
  return isNaN(v) ? 0 : v
}

/** Parse float; return null if missing/NaN (most columns). */
function numN(raw: Record<string, string>, key: string | undefined): number | null {
  if (!key) return null
  const v = parseFloat(raw[key] ?? '')
  return isNaN(v) ? null : v
}

/** Parse float; return null if missing/NaN/zero (for null-when-0 columns). */
function numOrNull(raw: Record<string, string>, key: string | undefined): number | null {
  if (!key) return null
  const v = parseFloat(raw[key] ?? '')
  return isNaN(v) || v === 0 ? null : v
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseOBDCsv(csvText: string, tripId: string): ParseResult {
  const lines = csvText.split('\n')

  // Primary: derive from filename stem (CSVLog_YYYYMMDD_HHMMSS)
  let startTime: Date
  let ts_source: ParseResult['ts_source']
  try {
    startTime = deriveTripTs(tripId)
    ts_source = 'filename'
  } catch {
    // Fallback: parse StartTime comment on line 0 (strip BOM first)
    const commentDate = parseStartTime(lines[0] ?? '')
    if (!commentDate) throw new Error(`Cannot derive timestamp for trip: ${tripId}`)
    startTime = commentDate
    ts_source = 'comment'
  }

  // Line 0: comment, Line 1: headers
  const headerLine = lines[1] ?? ''
  const headers = headerLine.split(',').map(h => h.trim())

  // Build column lookup map (case-insensitive substring search)
  const C = {
    time:       findCol(headers, 'Time (sec)'),
    load:       findCol(headers, 'Calculated load'),
    coolant:    findCol(headers, 'Engine coolant temperature'),
    stft_b1:    findCol(headers, 'Short term fuel % trim - Bank 1'),
    ltft_b1:    findCol(headers, 'Long term fuel % trim - Bank 1'),
    stft_b2:    findCol(headers, 'Short term fuel % trim - Bank 2'),
    ltft_b2:    findCol(headers, 'Long term fuel % trim - Bank 2'),
    map:        findCol(headers, 'Intake manifold absolute pressure'),
    rpm:        findCol(headers, 'Engine RPM'),
    speed:      findCol(headers, 'Vehicle speed'),
    timing:     findCol(headers, 'Ignition timing advance'),
    iat:        findCol(headers, 'Intake air temperature'),
    throttle:   findCol(headers, 'Absolute throttle position'),
    runtime:    findCol(headers, 'Time since engine start'),
    fuel_level: findCol(headers, 'Fuel level input', 'Fuel Level Input'),
    baro:       findCol(headers, 'Barometric pressure', 'Barometric Pressure'),
    lambda:     findCol(headers, 'Fuel/Air commanded equivalence', 'commanded equivalence ratio'),
    ambient:    findCol(headers, 'Ambient air temperature', 'Ambient Air Temperature'),
    pedal:      findCol(headers, 'Accelerator pedal position D'),
    oil:        findCol(headers, 'Engine oil temperature'),
    maf_a:      findCol(headers, 'Mass air flow sensor A'),
    maf_b:      findCol(headers, 'Mass air flow sensor B'),
    rail:       findCol(headers, 'Fuel rail pressure A', 'Fuel Rail Pressure A', 'rail pressure A (inHg)'),
    rail_cmd:   findCol(headers, 'Commanded fuel rail pressure A', 'commanded fuel rail'),
    cat_b1:     findCol(headers, 'Catalyst temperature (B1S1)', 'Catalyst temperature B1S1', 'catalyst temp.*b1s1'),
    cat_b2:     findCol(headers, 'Catalyst temperature (B2S1)', 'Catalyst temperature B2S1', 'catalyst temp.*b2s1'),
    fuel_sys:   findCol(headers, 'Fuel system 1 status', 'Fuel System 1'),
    turbo_a:    findCol(headers, 'Turbocharger A RPM', 'Turbocharger compressor A'),
    turbo_b:    findCol(headers, 'Turbocharger B RPM', 'Turbocharger compressor B'),
    fuel_rate:  findCol(headers, 'Engine Fuel Rate'),
    odo:        findCol(headers, 'Vehicle Odometer', 'Odometer Reading'),
    boost:      findCol(headers, 'Boost (psi)'),
    lat:        findCol(headers, 'Latitude (deg)', 'Latitude'),
    lon:        findCol(headers, 'Longitude (deg)', 'Longitude'),
    alt:        findCol(headers, 'Altitude (ft)', 'Altitude'),
    gps_speed:  findCol(headers, 'GPS Speed'),
    gps_acc:    findCol(headers, 'Horz Accuracy', 'Horz accuracy'),
    volts:      findCol(headers, 'Adapter voltage'),
    pid_hz:     findCol(headers, 'PID refresh rate', 'PID Refresh Rate'),
  }

  const rawRows: OBDRawRow[] = []

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = line.split(',')
    const raw: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      raw[headers[j]!] = values[j] ?? ''
    }

    const t_rel  = num(raw, C.time)
    const ts_ms  = startTime.getTime() + t_rel * 1000

    // Rail pressure: CSV is inHg → convert to psi (×0.4912)
    const railRaw    = C.rail    ? parseFloat(raw[C.rail]    ?? '') : NaN
    const railCmdRaw = C.rail_cmd ? parseFloat(raw[C.rail_cmd] ?? '') : NaN

    rawRows.push({
      trip_id:          tripId,
      t_rel,
      ts_ms,
      load_pct:         num(raw, C.load),
      coolant_f:        numN(raw, C.coolant),
      stft_b1:          numN(raw, C.stft_b1),
      ltft_b1:          numN(raw, C.ltft_b1),
      stft_b2:          numN(raw, C.stft_b2),
      ltft_b2:          numN(raw, C.ltft_b2),
      map_inhg:         numN(raw, C.map),
      rpm:              num(raw, C.rpm),
      speed_mph:        num(raw, C.speed),
      timing_deg:       numN(raw, C.timing),
      iat_f:            numOrNull(raw, C.iat),      // null when 0 (dead)
      throttle_pct:     numN(raw, C.throttle),
      engine_runtime_s: numN(raw, C.runtime),
      fuel_level_pct:   numN(raw, C.fuel_level),
      baro_inhg:        numN(raw, C.baro),
      lambda_cmd:       numN(raw, C.lambda),        // 0 = fuel cut, kept as-is
      ambient_f:        numN(raw, C.ambient),
      pedal_pct:        numN(raw, C.pedal),
      oil_f:            numN(raw, C.oil),
      maf_a:            numN(raw, C.maf_a),
      maf_b:            numN(raw, C.maf_b),
      rail_psi:         isNaN(railRaw) || railRaw === 0 ? null : railRaw * 0.4912,
      rail_cmd_psi:     isNaN(railCmdRaw) || railCmdRaw === 0 ? null : railCmdRaw * 0.4912,
      cat_b1_f:         numOrNull(raw, C.cat_b1),  // null when 0 (not lit)
      cat_b2_f:         numOrNull(raw, C.cat_b2),
      fuel_sys_status:  numN(raw, C.fuel_sys),
      turbo_a:          numN(raw, C.turbo_a),
      turbo_b:          numN(raw, C.turbo_b),
      fuel_lbmin:       num(raw, C.fuel_rate),      // 0 = DFCO (real)
      odo_mi:           numOrNull(raw, C.odo),
      boost_psi:        num(raw, C.boost),           // 0 is real
      lat:              numOrNull(raw, C.lat),        // null when 0 = no fix
      lon:              numOrNull(raw, C.lon),
      alt_ft:           numOrNull(raw, C.alt),
      gps_mph:          num(raw, C.gps_speed),
      gps_acc_ft:       numOrNull(raw, C.gps_acc),   // null when 0
      volts:            numN(raw, C.volts),
      pid_hz:           numN(raw, C.pid_hz),
    })
  }

  // Drop frame 0 (all-zero init row)
  if (rawRows.length > 0) rawRows.shift()

  // Trim trailing engine-off (rpm=0) frames; capture shutdown_volts
  let shutdownVolts: number | null = null
  while (rawRows.length > 0 && rawRows[rawRows.length - 1]!.rpm === 0) {
    const last = rawRows.pop()!
    if (shutdownVolts === null && last.volts !== null) shutdownVolts = last.volts
  }

  return { startTime, ts_source, shutdownVolts, rows: rawRows }
}
