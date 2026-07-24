import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupStations } from './AndStationsProvider'
import type { GeoPoint } from '../../lib/geo'

// The IPE flux returns one row per station × product; only some rows are
// guaranteed to carry the station footprint polygon.
const RINGS = [
  [
    [1.5, 42.5],
    [1.502, 42.5],
    [1.502, 42.502],
    [1.5, 42.502],
    [1.5, 42.5],
  ],
]

const row = (
  idIPE: number,
  idProducte: number,
  PREU: number,
  opts: { geometry?: unknown; NOM?: string; Parroquia?: string; Codi_parroquia?: string } = {},
) => ({
  attributes: {
    idIPE,
    idProducte,
    PREU,
    NOM: opts.NOM ?? 'TotalEnergies - LA MASSANA I',
    Parroquia: opts.Parroquia,
    Codi_parroquia: opts.Codi_parroquia,
  },
  ...(opts.geometry !== undefined ? { geometry: opts.geometry } : {}),
})

describe('groupStations', () => {
  it('groups rows by idIPE and maps products to fuels', () => {
    const stations = groupStations([
      row(12, 6, 1.5, { geometry: { rings: RINGS }, Parroquia: 'La Massana', Codi_parroquia: '4' }),
      row(12, 4, 1.62, { geometry: { rings: RINGS } }),
      row(12, 9, 0.8, { geometry: { rings: RINGS } }), // AdBlue → service
    ])
    expect(stations).toHaveLength(1)
    const st = stations[0]
    expect(st.id).toBe('and-12')
    expect(st.name).toBe('TotalEnergies · La Massana I')
    expect(st.brand).toBe('TotalEnergies')
    expect(st.prices.gazole?.value).toBe(1.5)
    expect(st.prices.sp95?.value).toBe(1.62)
    expect(st.city).toBe('La Massana')
    expect(st.cp).toBe('4')
    expect(st.tags).toEqual(['Additifs'])
    expect(st.lat).toBeCloseTo(42.501, 3)
    expect(st.lng).toBeCloseTo(1.501, 3)
  })

  it('keeps prices from rows that precede the first geometry-bearing row', () => {
    const stations = groupStations([
      row(12, 6, 1.5), // gazole, no geometry at all
      row(12, 4, 1.62, { geometry: { rings: 'nope' } }), // sp95, malformed rings
      row(12, 5, 1.71, { geometry: { rings: RINGS } }), // sp98, finally a polygon
    ])
    expect(stations).toHaveLength(1)
    expect(stations[0].prices.gazole?.value).toBe(1.5)
    expect(stations[0].prices.sp95?.value).toBe(1.62)
    expect(stations[0].prices.sp98?.value).toBe(1.71)
    expect(stations[0].lat).toBeCloseTo(42.501, 3)
  })

  it('keeps a single-fuel station whose only row lacks geometry', () => {
    const stations = groupStations([
      row(12, 6, 1.5), // the one and only fuel row, no geometry
      row(12, 9, 0.8, { geometry: { rings: RINGS } }), // AdBlue carries the polygon
    ])
    expect(stations).toHaveLength(1)
    expect(stations[0].prices.gazole?.value).toBe(1.5)
    expect(stations[0].services).toEqual(['AdBlue'])
  })

  it('fills the parish from whichever row supplies it', () => {
    const stations = groupStations([
      row(12, 6, 1.5),
      row(12, 4, 1.62, {
        geometry: { rings: RINGS },
        Parroquia: 'Encamp',
        Codi_parroquia: '3',
      }),
    ])
    expect(stations[0].city).toBe('Encamp')
    expect(stations[0].cp).toBe('3')
  })

  it('drops a station when no row ever carries a usable polygon', () => {
    expect(groupStations([row(12, 6, 1.5), row(12, 4, 1.62)])).toEqual([])
    // …and one whose rings hold no numeric vertex
    expect(groupStations([row(13, 6, 1.5, { geometry: { rings: [[['a', 'b']]] } })])).toEqual([])
  })

  it('drops heating-oil distributors and out-of-range prices', () => {
    const stations = groupStations([
      // Fioul only → not a fuel station
      row(20, 7, 0.95, { geometry: { rings: RINGS }, NOM: 'GASOPAS' }),
      // A road fuel priced outside [0.5, 3.5] is not a price
      row(21, 6, 42, { geometry: { rings: RINGS } }),
    ])
    expect(stations).toEqual([])
  })

  it('ignores rows without an id or a name, and non-object features', () => {
    const stations = groupStations([
      null,
      'nope',
      { attributes: { idProducte: 6, PREU: 1.5 }, geometry: { rings: RINGS } },
      { attributes: { idIPE: 12, idProducte: 6, PREU: 1.5 }, geometry: { rings: RINGS } },
    ])
    expect(stations).toEqual([])
  })
})

// ── Country memo ─────────────────────────────────────────────────────────────
const ANDORRA: GeoPoint = { lat: 42.52, lng: 1.61 }
const BODY = { features: [row(12, 6, 1.5, { geometry: { rings: RINGS } })] }

/** A `fetch` whose responses only land when the test says so. */
function deferredFetch() {
  const pending: Array<{ settle: (fail?: boolean) => void }> = []
  const mock = vi.fn(
    () =>
      new Promise<Response>((resolve, reject) => {
        pending.push({
          settle: (fail) =>
            fail
              ? reject(new Error('boom'))
              : resolve({ ok: true, status: 200, json: async () => BODY } as Response),
        })
      }),
  )
  vi.stubGlobal('fetch', mock)
  return {
    mock,
    settleAll: async (fail = false) => {
      for (const p of pending.splice(0)) p.settle(fail)
      await Promise.resolve()
    },
  }
}

async function freshProvider() {
  vi.resetModules()
  const mod = await import('./AndStationsProvider')
  return new mod.AndStationsProvider()
}

describe('country fetch memo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands the in-flight request to a concurrent caller', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const near = provider.getStationsNear(ANDORRA, 25)
    const along = provider.getStationsAlong([ANDORRA, { lat: 42.55, lng: 1.65 }], 25)
    expect(mock).toHaveBeenCalledTimes(1)

    await settleAll()
    expect(await near).toHaveLength(1)
    expect(await along).toHaveLength(1)
  })

  it('reuses the memo once the response has landed', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(ANDORRA, 25)
    await settleAll()
    await first

    await provider.getStationsNear(ANDORRA, 25)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('evicts a failed fetch so the next query retries', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(ANDORRA, 25)
    await settleAll(true)
    await expect(first).rejects.toThrow()

    const second = provider.getStationsNear(ANDORRA, 25)
    expect(mock).toHaveBeenCalledTimes(2)
    await settleAll()
    await second
  })
})
