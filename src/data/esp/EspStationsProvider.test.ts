import { afterEach, describe, expect, it } from 'vitest'
import { fechaToIso } from './EspStationsProvider'

// Browser-typed project, Node-run tests — see src/lib/time.test.ts
declare const process: { env: { TZ?: string } }

const original = process.env.TZ
afterEach(() => {
  process.env.TZ = original
})

describe('fechaToIso', () => {
  it('reads the flux header as a Madrid wall clock', () => {
    // CEST (+02:00) in July, CET (+01:00) in January
    expect(fechaToIso('19/07/2026 5:40:23')).toBe('2026-07-19T03:40:23.000Z')
    expect(fechaToIso('15/01/2026 18:05:00')).toBe('2026-01-15T17:05:00.000Z')
  })

  it('resolves the same instant whatever the device zone is', () => {
    for (const tz of ['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz
      expect(fechaToIso('19/07/2026 5:40:23')).toBe('2026-07-19T03:40:23.000Z')
    }
  })

  it('ignores anything that is not the expected shape', () => {
    expect(fechaToIso(undefined)).toBe(undefined)
    expect(fechaToIso('')).toBe(undefined)
    expect(fechaToIso('2026-07-19T05:40:23')).toBe(undefined)
    expect(fechaToIso('19/07/2026 5:40')).toBe(undefined)
  })
})
