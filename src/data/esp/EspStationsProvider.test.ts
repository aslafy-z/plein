import { afterEach, describe, expect, it, vi } from 'vitest'
import { fluxDateToIso, parseOpeningHours, parseRecord } from './EspStationsProvider'
import type { GeoPoint } from '../../lib/geo'

// Browser-typed project, Node-run tests — see src/lib/time.test.ts
declare const process: { env: { TZ?: string } }

const original = process.env.TZ
afterEach(() => {
  process.env.TZ = original
})

describe('fluxDateToIso', () => {
  it('reads the flux header as a Madrid wall clock', () => {
    // CEST (+02:00) in July, CET (+01:00) in January
    expect(fluxDateToIso('19/07/2026 5:40:23')).toBe('2026-07-19T03:40:23.000Z')
    expect(fluxDateToIso('15/01/2026 18:05:00')).toBe('2026-01-15T17:05:00.000Z')
  })

  it('resolves the same instant whatever the device zone is', () => {
    for (const tz of ['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz
      expect(fluxDateToIso('19/07/2026 5:40:23')).toBe('2026-07-19T03:40:23.000Z')
    }
  })

  it('ignores anything that is not the expected shape', () => {
    expect(fluxDateToIso(undefined)).toBe(undefined)
    expect(fluxDateToIso('')).toBe(undefined)
    expect(fluxDateToIso('2026-07-19T05:40:23')).toBe(undefined)
    expect(fluxDateToIso('19/07/2026 5:40')).toBe(undefined)
  })
})

// ── Horario ──────────────────────────────────────────────────────────────────
// Compact Spanish notation, day letters L M X J V S D (lunes … domingo).
describe('parseOpeningHours', () => {
  const ALL_DAY = [{ open: 0, close: 24 * 60 }]

  it('reads the always-open shorthand as a 24/24 station', () => {
    expect(parseOpeningHours('L-D: 24H')).toEqual({ auto24: true, days: {} })
    expect(parseOpeningHours('l-d:24 h')).toEqual({ auto24: true, days: {} })
  })

  it('expands a day-letter range over every day it spans', () => {
    expect(parseOpeningHours('L-V: 06:00-22:00')).toEqual({
      auto24: false,
      days: {
        1: { closed: false, ranges: [{ open: 360, close: 1320 }] },
        2: { closed: false, ranges: [{ open: 360, close: 1320 }] },
        3: { closed: false, ranges: [{ open: 360, close: 1320 }] },
        4: { closed: false, ranges: [{ open: 360, close: 1320 }] },
        5: { closed: false, ranges: [{ open: 360, close: 1320 }] },
      },
    })
  })

  it('reads every segment of a multi-segment horario', () => {
    const hours = parseOpeningHours('L-V: 06:00-22:00; S-D: 07:00-22:00')
    expect(Object.keys(hours?.days ?? {})).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(hours?.days[5]).toEqual({ closed: false, ranges: [{ open: 360, close: 1320 }] })
    expect(hours?.days[7]).toEqual({ closed: false, ranges: [{ open: 420, close: 1320 }] })
  })

  it('keeps both halves of a split day', () => {
    expect(parseOpeningHours('L: 07:00-14:00 y 16:00-22:00')?.days[1]).toEqual({
      closed: false,
      ranges: [
        { open: 420, close: 840 },
        { open: 960, close: 1320 },
      ],
    })
  })

  it('reads a single day, 24H or not', () => {
    expect(parseOpeningHours('L: 24H')).toEqual({
      auto24: false,
      days: { 1: { closed: false, ranges: ALL_DAY } },
    })
    expect(parseOpeningHours('D: 09:00-14:00')).toEqual({
      auto24: false,
      days: { 7: { closed: false, ranges: [{ open: 540, close: 840 }] } },
    })
  })

  it('marks a whole-week range open around the clock without claiming 24/24', () => {
    // Only the "L-D: 24H" shorthand sets auto24 — this spelling stays per-day
    const hours = parseOpeningHours('L-S: 24H; D: 09:00-14:00')
    expect(hours?.auto24).toBe(false)
    expect(hours?.days[6]).toEqual({ closed: false, ranges: ALL_DAY })
  })

  it('skips segments it cannot read, keeping the rest', () => {
    expect(parseOpeningHours('L-V: horario variable; S: 09:00-14:00')).toEqual({
      auto24: false,
      days: { 6: { closed: false, ranges: [{ open: 540, close: 840 }] } },
    })
    // A backwards letter range carries no usable information
    expect(parseOpeningHours('V-L: 06:00-22:00')).toBe(undefined)
    // Neither does a zero-length range
    expect(parseOpeningHours('L: 00:00-00:00')).toBe(undefined)
  })

  it('returns unknown for an empty or unreadable horario', () => {
    expect(parseOpeningHours(undefined)).toBe(undefined)
    expect(parseOpeningHours('')).toBe(undefined)
    expect(parseOpeningHours('   ')).toBe(undefined)
    expect(parseOpeningHours(24)).toBe(undefined)
    expect(parseOpeningHours('Consultar en la estación')).toBe(undefined)
  })
})

// ── Extra products ───────────────────────────────────────────────────────────
// The flux prices every product on sale, AdBlue included. A price means the
// station dispenses it; an empty column means it does not.
describe('parseRecord — AdBlue', () => {
  const STAMP = '2026-07-19T03:40:23.000Z'
  const record = (over: Record<string, unknown> = {}) => ({
    IDEESS: '1',
    Latitud: '40,4165',
    'Longitud (WGS84)': '-3,7026',
    'Precio Gasoleo A': '1,499',
    Municipio: 'MADRID',
    ...over,
  })

  it('tags and prices a station whose AdBlue column parses', () => {
    const st = parseRecord(record({ 'Precio Adblue': '0,799' }), STAMP)
    expect(st?.tags).toContain('adBlue')
    expect(st?.services).toContain('adBlue')
    expect(st?.extraPrices?.adBlue).toEqual({ value: 0.799, updatedAt: STAMP })
  })

  it('leaves the tag off when the column is empty or unreadable', () => {
    for (const value of ['', '   ', undefined, 'N/A']) {
      const st = parseRecord(record({ 'Precio Adblue': value }), STAMP)
      expect(st?.tags).not.toContain('adBlue')
      expect(st?.services).not.toContain('adBlue')
      expect(st?.extraPrices?.adBlue).toBe(undefined)
    }
  })

  it('keeps « additives » on a premium-diesel-only station, without claiming AdBlue', () => {
    const st = parseRecord(record({ 'Precio Gasoleo Premium': '1,699' }), STAMP)
    expect(st?.tags).toContain('additives')
    expect(st?.tags).not.toContain('adBlue')
    expect(st?.extraPrices?.dieselPremium?.value).toBe(1.699)
  })

  it('sets both tags when the station sells AdBlue and premium diesel', () => {
    const st = parseRecord(
      record({ 'Precio Adblue': '0,799', 'Precio Gasoleo Premium': '1,699' }),
      STAMP,
    )
    expect(st?.tags).toEqual(expect.arrayContaining(['additives', 'adBlue']))
  })
})

// ── Province memo ────────────────────────────────────────────────────────────
// A province payload weighs hundreds of KB to a few MB, so overlapping callers
// must share the in-flight request instead of each downloading their own copy.
const BODY = {
  Fecha: '19/07/2026 5:40:23',
  ResultadoConsulta: 'OK',
  ListaEESSPrecio: [
    {
      IDEESS: '1',
      Latitud: '40,4165',
      'Longitud (WGS84)': '-3,7026',
      'Precio Gasoleo A': '1,499',
      'Rótulo': 'REPSOL',
      Municipio: 'MADRID',
    },
  ],
}

const MADRID: GeoPoint = { lat: 40.4165, lng: -3.7026 }

/** A `fetch` whose responses only land when the test says so. */
function deferredFetch() {
  const pending: Array<{ settle: (fail?: boolean) => void }> = []
  const mock = vi.fn(
    (url: string) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({
          settle: (fail) =>
            fail
              ? reject(new Error(`boom ${url}`))
              : resolve({ ok: true, status: 200, json: async () => BODY } as Response),
        })
      }),
  )
  vi.stubGlobal('fetch', mock)
  return {
    mock,
    /** Settle every request issued so far (and let the awaiting code run). */
    settleAll: async (fail = false) => {
      for (const p of pending.splice(0)) p.settle(fail)
      await Promise.resolve()
    },
  }
}

async function freshProvider() {
  vi.resetModules()
  const mod = await import('./EspStationsProvider')
  return new mod.EspStationsProvider()
}

describe('province fetch memo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands the in-flight request to a concurrent caller', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    // Both queries are issued before any response lands
    const first = provider.getStationsNear(MADRID, 5)
    const issued = mock.mock.calls.length
    expect(issued).toBeGreaterThan(0)
    const second = provider.getStationsNear(MADRID, 5)

    expect(mock.mock.calls.length).toBe(issued)
    const urls = mock.mock.calls.map((c) => c[0])
    expect(new Set(urls).size).toBe(urls.length)

    await settleAll()
    expect(await first).toEqual(await second)
  })

  it('shares the request between a zone query and a route query', async () => {
    const route: GeoPoint[] = [MADRID, { lat: 40.5, lng: -3.6 }]

    // What the route query costs on its own, with nothing already in flight
    const solo = await freshProvider()
    const soloFetch = deferredFetch()
    const soloAlong = solo.getStationsAlong(route, 5)
    const soloCount = soloFetch.mock.mock.calls.length
    await soloFetch.settleAll()
    await soloAlong
    vi.unstubAllGlobals()

    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()
    const near = provider.getStationsNear(MADRID, 5)
    const nearCount = mock.mock.calls.length
    const along = provider.getStationsAlong(route, 5)

    // The corridor may reach provinces the zone did not, but the ones both
    // need are downloaded once — the two paths don't share a request path.
    expect(mock.mock.calls.length).toBeLessThan(nearCount + soloCount)
    const urls = mock.mock.calls.map((c) => c[0])
    expect(new Set(urls).size).toBe(urls.length)

    await settleAll()
    await near
    await along
  })

  it('reuses the memo once the response has landed', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(MADRID, 5)
    await settleAll()
    await first
    const issued = mock.mock.calls.length

    await provider.getStationsNear(MADRID, 5)
    expect(mock.mock.calls.length).toBe(issued)
  })

  it('evicts a failed fetch so the next query retries', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(MADRID, 5)
    const issued = mock.mock.calls.length
    await settleAll(true)
    await expect(first).rejects.toThrow()

    const second = provider.getStationsNear(MADRID, 5)
    expect(mock.mock.calls.length).toBe(issued * 2)
    await settleAll()
    await second
  })
})
