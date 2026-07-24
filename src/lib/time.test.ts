import { afterEach, describe, expect, it } from 'vitest'
import { zonedTimeToMs } from './time'

// The app project types browser globals only (`types: ["vite/client"]`), yet
// the unit tests run on Node — where re-assigning TZ re-reads the local zone.
declare const process: { env: { TZ?: string } }

// The device's own zone must never leak into the reading
const RUNTIME_ZONES = [
  'UTC',
  'Europe/Paris',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Pacific/Kiritimati',
]

const original = process.env.TZ
afterEach(() => {
  process.env.TZ = original
})

const madrid = (...f: [number, number, number, number, number, number]) =>
  new Date(zonedTimeToMs('Europe/Madrid', ...f)).toISOString()

describe('zonedTimeToMs', () => {
  it('applies the winter offset (CET, +01:00)', () => {
    expect(madrid(2026, 1, 15, 5, 40, 23)).toBe('2026-01-15T04:40:23.000Z')
  })

  it('applies the summer offset (CEST, +02:00)', () => {
    expect(madrid(2026, 7, 19, 5, 40, 23)).toBe('2026-07-19T03:40:23.000Z')
  })

  it('lands on the right side of the spring-forward switch', () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST
    expect(madrid(2026, 3, 29, 1, 59, 59)).toBe('2026-03-29T00:59:59.000Z')
    expect(madrid(2026, 3, 29, 3, 0, 0)).toBe('2026-03-29T01:00:00.000Z')
  })

  it('lands on the right side of the fall-back switch', () => {
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET
    expect(madrid(2026, 10, 25, 0, 30, 0)).toBe('2026-10-24T22:30:00.000Z')
    expect(madrid(2026, 10, 25, 3, 30, 0)).toBe('2026-10-25T02:30:00.000Z')
  })

  it('reads other zones too', () => {
    expect(new Date(zonedTimeToMs('UTC', 2026, 7, 19, 5, 40, 23)).toISOString()).toBe(
      '2026-07-19T05:40:23.000Z',
    )
    expect(new Date(zonedTimeToMs('Atlantic/Canary', 2026, 7, 19, 5, 40, 23)).toISOString()).toBe(
      '2026-07-19T04:40:23.000Z',
    )
  })

  for (const tz of RUNTIME_ZONES) {
    it(`resolves the same instant under TZ=${tz}`, () => {
      process.env.TZ = tz
      expect(madrid(2026, 7, 19, 5, 40, 23)).toBe('2026-07-19T03:40:23.000Z')
      expect(madrid(2026, 1, 15, 5, 40, 23)).toBe('2026-01-15T04:40:23.000Z')
    })
  }
})
