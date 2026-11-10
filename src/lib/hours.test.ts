import { describe, expect, it } from 'vitest'
import { openStatus, stationOpenStatus, stationTimeZone, type StationHours } from './hours'

// 2026-07-15 is a Wednesday (ISO day 3); every check pins `now` explicitly.
const at = (h: number, min = 0) => new Date(2026, 6, 15, h, min)

const staffed = (open: number, close: number, days: number[] = [1, 2, 3, 4, 5, 6, 7]): StationHours => ({
  auto24: false,
  days: Object.fromEntries(days.map((d) => [d, { closed: false, ranges: [{ open, close }] }])),
})

describe('openStatus', () => {
  it('is unknown without data — never claims « Open » without evidence', () => {
    expect(openStatus(undefined, at(12))).toBeNull()
    // A day listed as open but without time ranges counts as unknown too
    expect(openStatus({ auto24: false, days: { 3: { closed: false, ranges: [] } } }, at(12))).toBeNull()
    // …and so does a day the source says nothing about
    expect(openStatus(staffed(8 * 60, 19 * 60, [1, 2]), at(12))).toBeNull()
  })

  it('24/24 automats are always open', () => {
    const s = openStatus({ auto24: true, days: {} }, at(3))
    expect(s).toEqual({ open: true, kind: 'open24h' })
  })

  it('a staffed range opens and closes at the right minutes', () => {
    const hours = staffed(8 * 60, 21 * 60 + 30)
    expect(openStatus(hours, at(12))).toEqual({
      open: true,
      kind: 'openUntil',
      atMinutes: 21 * 60 + 30,
    })
    expect(openStatus(hours, at(7, 59))).toEqual({
      open: false,
      kind: 'opensAt',
      atMinutes: 8 * 60,
    })
    // Past the last range of the day → closed with no reopening time
    expect(openStatus(hours, at(22))).toEqual({ open: false, kind: 'closed' })
  })

  it('a closed day says so', () => {
    const hours: StationHours = {
      auto24: false,
      days: { 3: { closed: true, ranges: [] } },
    }
    expect(openStatus(hours, at(12))).toEqual({ open: false, kind: 'closedToday' })
  })

  it("an overnight range spills past midnight into the next day", () => {
    // Open 22 h – 6 h every day: at 2 h the station is open via YESTERDAY's range
    const hours = staffed(22 * 60, 6 * 60)
    expect(openStatus(hours, at(2))).toEqual({
      open: true,
      kind: 'openUntil',
      // 6 h of the NEXT day, counted from yesterday's midnight
      atMinutes: 30 * 60,
    })
    expect(openStatus(hours, at(12))?.open).toBe(false)
  })
})

// Every instant below is pinned in UTC and read in a named zone, so these hold
// whatever zone the runner is in.
describe('openStatus on the station wall clock', () => {
  it('reads the weekday and the minutes in the given zone, not on the device', () => {
    const hours = staffed(8 * 60, 21 * 60)
    // 2026-07-15 19:30 UTC: 21:30 in Madrid (closed), 20:30 in the Canaries (still open)
    const now = new Date(Date.UTC(2026, 6, 15, 19, 30))
    expect(openStatus(hours, now, 'Europe/Madrid')).toEqual({ open: false, kind: 'closed' })
    expect(openStatus(hours, now, 'Atlantic/Canary')).toEqual({
      open: true,
      kind: 'openUntil',
      atMinutes: 21 * 60,
    })
  })

  it('takes the weekday from the zone when the date differs from UTC', () => {
    // Wednesday only. 2026-07-14 22:30 UTC is still Tuesday in UTC, already Wednesday 00:30 in Paris…
    const wednesday = staffed(0, 6 * 60, [3])
    const now = new Date(Date.UTC(2026, 6, 14, 22, 30))
    expect(openStatus(wednesday, now, 'Europe/Paris')).toEqual({
      open: true,
      kind: 'openUntil',
      atMinutes: 6 * 60,
    })
    // …and Tuesday 18:30 in Guadeloupe, a day the source says nothing about
    expect(openStatus(wednesday, now, 'America/Guadeloupe')).toBeNull()
  })

  it('finds yesterday by weekday on the day after the spring switch', () => {
    // Saturday 22 h – 6 h, Sunday closed. Sunday 2026-03-29 has 23 hours in
    // Paris, so Monday 00:30 minus 24 h lands on Saturday 23:30, not Sunday.
    const hours: StationHours = {
      auto24: false,
      days: {
        6: { closed: false, ranges: [{ open: 22 * 60, close: 6 * 60 }] },
        7: { closed: true, ranges: [] },
        1: { closed: false, ranges: [{ open: 8 * 60, close: 20 * 60 }] },
      },
    }
    const monday0030 = new Date(Date.UTC(2026, 2, 29, 22, 30))
    expect(openStatus(hours, monday0030, 'Europe/Paris')).toEqual({
      open: false,
      kind: 'opensAt',
      atMinutes: 8 * 60,
    })
    // Sunday 02:00 UTC is 04:00 in Paris, past the skipped hour: Saturday's range still runs
    expect(openStatus(hours, new Date(Date.UTC(2026, 2, 29, 2, 0)), 'Europe/Paris')).toEqual({
      open: true,
      kind: 'openUntil',
      atMinutes: 30 * 60,
    })
  })

  it('keeps the overnight spill on the day after the autumn switch', () => {
    // Sunday 22 h – 6 h only. Sunday 2026-10-25 has 25 hours in Paris; Monday 00:30 is Sunday 23:30 UTC
    const hours = staffed(22 * 60, 6 * 60, [7])
    expect(openStatus(hours, new Date(Date.UTC(2026, 9, 25, 23, 30)), 'Europe/Paris')).toEqual({
      open: true,
      kind: 'openUntil',
      atMinutes: 30 * 60,
    })
  })

  it('falls back to the device clock for a zone the runtime does not know', () => {
    const hours = staffed(8 * 60, 21 * 60)
    expect(openStatus(hours, at(12), 'Nowhere/Nothing')).toEqual(openStatus(hours, at(12)))
  })
})

describe('stationTimeZone', () => {
  it.each([
    ['fr-31000009', 43.6, 1.44, 'Europe/Paris'], // Toulouse
    ['fr-20000001', 41.92, 8.74, 'Europe/Paris'], // Ajaccio
    ['fr-97100001', 16.24, -61.53, 'America/Guadeloupe'], // Pointe-à-Pitre
    ['fr-97200001', 14.6, -61.07, 'America/Guadeloupe'], // Fort-de-France, same clock
    ['fr-97300001', 4.93, -52.33, 'America/Cayenne'],
    ['fr-97400001', -20.88, 55.45, 'Indian/Reunion'],
    ['fr-97600001', -12.78, 45.23, 'Indian/Mayotte'],
    ['es-1234', 40.42, -3.7, 'Europe/Madrid'],
    ['es-2345', 42.88, -9.27, 'Europe/Madrid'], // Fisterra, the peninsula's western tip
    ['es-3456', 35.89, -5.32, 'Europe/Madrid'], // Ceuta
    ['es-4567', 28.96, -13.55, 'Atlantic/Canary'], // Lanzarote, the easternmost island
    ['es-5678', 27.81, -17.92, 'Atlantic/Canary'], // El Hierro
    ['ad-42', 42.51, 1.52, 'Europe/Andorra'],
    ['pt-67360', 38.72, -9.14, 'Europe/Lisbon'],
    ['pt-1', 32.65, -16.91, 'Europe/Lisbon'], // Funchal
    ['pt-2', 37.74, -25.67, 'Atlantic/Azores'], // Ponta Delgada
  ])('%s at %f, %f → %s', (id, lat, lng, zone) => {
    expect(stationTimeZone({ id, lat, lng })).toBe(zone)
  })

  it('leaves ids outside the country scheme (demo) on the device clock', () => {
    expect(stationTimeZone({ id: 'su', lat: 43.6, lng: 1.44 })).toBeUndefined()
  })
})

describe('stationOpenStatus', () => {
  it('judges a Canary station on Canary time and a peninsular one on Madrid time', () => {
    const hours = staffed(8 * 60, 21 * 60)
    const now = new Date(Date.UTC(2026, 6, 15, 19, 30)) // 21:30 in Madrid, 20:30 in Las Palmas
    expect(stationOpenStatus({ id: 'es-1', lat: 40.42, lng: -3.7, hours }, now)?.open).toBe(false)
    expect(stationOpenStatus({ id: 'es-2', lat: 28.1, lng: -15.42, hours }, now)?.open).toBe(true)
  })
})
