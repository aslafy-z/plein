import { afterEach, describe, expect, it, vi } from 'vitest'
import { fechaToIso } from './EspStationsProvider'
import type { GeoPoint } from '../../lib/geo'

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
