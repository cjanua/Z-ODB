import { describe, test, expect } from 'bun:test'
import { tripTsFromFilename, tripTsToEpochMs, epochMsToDate, epochMsToDateOrFallback, formatTripDate } from './trip-date'

describe('trip timestamp round-trip', () => {
  const FILENAME = 'CSVLog_20260905_173049'

  test('parses filename into correct local date', () => {
    const d = tripTsFromFilename(FILENAME)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(5)
    expect(d.getHours()).toBe(17)
    expect(d.getMinutes()).toBe(30)
    expect(d.getSeconds()).toBe(49)
  })

  test('epoch ms round-trips back to same local date', () => {
    const original = tripTsFromFilename(FILENAME)
    const ms = tripTsToEpochMs(original)
    const restored = epochMsToDate(ms)!

    expect(restored.getFullYear()).toBe(2026)
    expect(restored.getMonth()).toBe(8)
    expect(restored.getDate()).toBe(5)
    expect(restored.getHours()).toBe(17)
    expect(restored.getMinutes()).toBe(30)
    expect(restored.getSeconds()).toBe(49)
  })

  test('epoch ms is never 0 for a valid filename', () => {
    const d = tripTsFromFilename(FILENAME)
    const ms = tripTsToEpochMs(d)
    expect(ms).toBeGreaterThan(0)
  })

  test('epochMsToDate returns null for bad values (Dec 31 1969 prevention)', () => {
    expect(epochMsToDate(0)).toBeNull()
    expect(epochMsToDate(null)).toBeNull()
    expect(epochMsToDate(undefined)).toBeNull()
    expect(epochMsToDate(NaN)).toBeNull()
  })

  test('epochMsToDateOrFallback derives from trip_id when epoch is null', () => {
    const d = epochMsToDateOrFallback(null, FILENAME)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(5)
    expect(d.getHours()).toBe(17)
  })

  test('epochMsToDate handles BigInt from DuckDB', () => {
    const d = tripTsFromFilename(FILENAME)
    const ms = tripTsToEpochMs(d)
    const restored = epochMsToDate(BigInt(ms))!
    expect(restored.getHours()).toBe(17)
    expect(restored.getMinutes()).toBe(30)
  })

  test('formatTripDate never returns Dec 31 1969', () => {
    const d = tripTsFromFilename(FILENAME)
    const formatted = formatTripDate(d)
    expect(formatted).not.toContain('1969')
    expect(formatted).toContain('2026')
  })

  test('throws on unparseable filename', () => {
    expect(() => tripTsFromFilename('random_file')).toThrow()
  })

  test('full pipeline: filename → epoch ms → Date → formatted string', () => {
    const d = tripTsFromFilename(FILENAME)
    const ms = tripTsToEpochMs(d)
    const restored = epochMsToDate(ms)!
    const formatted = formatTripDate(restored)

    expect(formatted).toContain('Sep')
    expect(formatted).toContain('5')
    expect(formatted).toContain('2026')
    expect(formatted).not.toContain('1969')
    expect(formatted).not.toContain('Dec')
  })
})
