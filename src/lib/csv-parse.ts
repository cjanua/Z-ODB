/**
 * OBD Fusion CSV format:
 *   Line 0: # StartTime = MM/DD/YYYY HH:MM:SS.ssss AM/PM
 *   Line 1: column headers
 *   Lines 2+: data rows
 *
 * trip_id is derived from the filename stem (e.g. "CSVLog_20260905_115849").
 */

export interface OBDRow {
  trip_id: string
  time_sec: number
  rpm: number
  speed_mph: number
  coolant_temp_f: number
  throttle_pct: number
  stft_b1_pct: number
  ltft_b1_pct: number
  stft_b2_pct: number
  ltft_b2_pct: number
  boost_psi: number
  map_inhg: number
  maf_a_lb_min: number
  fuel_rate_lb_min: number
  accel_pedal_pct: number
  oil_temp_f: number
  iat_f: number
  latitude: number
  longitude: number
  altitude_ft: number
  gps_speed_mph: number
  voltage_v: number
}

const COL = {
  time:        'Time (sec)',
  rpm:         'Engine RPM (RPM)',
  speed:       'Vehicle speed (MPH)',
  coolant:     'Engine coolant temperature (°F)',
  throttle:    'Absolute throttle position (%)',
  stft_b1:     'Short term fuel % trim - Bank 1 (%)',
  ltft_b1:     'Long term fuel % trim - Bank 1 (%)',
  stft_b2:     'Short term fuel % trim - Bank 2 (%)',
  ltft_b2:     'Long term fuel % trim - Bank 2 (%)',
  boost:       'Boost (psi)',
  map:         'Intake manifold absolute pressure (inHg)',
  maf_a:       'Mass air flow sensor A (lb/min)',
  fuel_rate:   'Engine Fuel Rate (lb/min)',
  accel:       'Accelerator pedal position D (%)',
  oil_temp:    'Engine oil temperature (°F)',
  iat:         'Intake air temperature (°F)',
  lat:         'Latitude (deg)',
  lon:         'Longitude (deg)',
  alt:         'Altitude (ft)',
  gps_speed:   'GPS Speed (MPH)',
  voltage:     'Adapter voltage (V)',
} as const

/** Parse trip timestamp from filename stem. */
export function deriveTripTs(stem: string): Date {
  // CSVLog_YYYYMMDD_HHMMSS
  const m = stem.match(/CSVLog_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
  if (!m) throw new Error(`Cannot parse trip timestamp from filename: ${stem}`)
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)
}

/** Parse trip_id (filename stem without extension). */
export function stemFromFilename(filename: string): string {
  return filename.replace(/\.csv$/i, '').replace(/^.*\//, '')
}

function num(row: Record<string, string>, key: string): number {
  const v = parseFloat(row[key] ?? '')
  return isNaN(v) ? 0 : v
}

/** Parse a raw OBD Fusion CSV text into typed rows. */
export function parseOBDCsv(csvText: string, tripId: string): OBDRow[] {
  const lines = csvText.split('\n')

  // Line 0 is the comment; line 1 is the header
  const headerLine = lines[1]
  if (!headerLine) return []

  const headers = headerLine.split(',').map(h => h.trim())
  const rows: OBDRow[] = []

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = line.split(',')
    const raw: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      raw[headers[j]] = values[j] ?? ''
    }

    rows.push({
      trip_id:         tripId,
      time_sec:        num(raw, COL.time),
      rpm:             num(raw, COL.rpm),
      speed_mph:       num(raw, COL.speed),
      coolant_temp_f:  num(raw, COL.coolant),
      throttle_pct:    num(raw, COL.throttle),
      stft_b1_pct:     num(raw, COL.stft_b1),
      ltft_b1_pct:     num(raw, COL.ltft_b1),
      stft_b2_pct:     num(raw, COL.stft_b2),
      ltft_b2_pct:     num(raw, COL.ltft_b2),
      boost_psi:       num(raw, COL.boost),
      map_inhg:        num(raw, COL.map),
      maf_a_lb_min:    num(raw, COL.maf_a),
      fuel_rate_lb_min: num(raw, COL.fuel_rate),
      accel_pedal_pct: num(raw, COL.accel),
      oil_temp_f:      num(raw, COL.oil_temp),
      iat_f:           num(raw, COL.iat),
      latitude:        num(raw, COL.lat),
      longitude:       num(raw, COL.lon),
      altitude_ft:     num(raw, COL.alt),
      gps_speed_mph:   num(raw, COL.gps_speed),
      voltage_v:       num(raw, COL.voltage),
    })
  }

  return rows
}
