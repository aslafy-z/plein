import { afterEach, describe, expect, it, vi } from 'vitest'
import { fluxDateToIso, groupStations, prtCoversNear, tidyBrand, toPrice } from './PrtStationsProvider'
import type { GeoPoint } from '../../lib/geo'

// Browser-typed project, Node-run tests — see src/lib/time.test.ts
declare const process: { env: { TZ?: string } }

const original = process.env.TZ
afterEach(() => {
  process.env.TZ = original
})

// The DGEG flux returns one row per station × product, every row repeating the
// station's own columns.
const row = (
  Id: number,
  Combustivel: string,
  Preco: string,
  opts: Partial<Record<string, unknown>> = {},
) => ({
  Id,
  Combustivel,
  Preco,
  DataAtualizacao: '2026-07-22 08:40',
  Nome: 'INTERMARCHE VILAR FORMOSO',
  Marca: 'INTERMARCHÉ',
  TipoPosto: 'Outro',
  Municipio: 'Almeida',
  Localidade: 'Vilar Formoso',
  Morada: 'SITIO DA REPRESA',
  CodPostal: '6355-289',
  Latitude: 40.61817,
  Longitude: -6.84339,
  ...opts,
})

describe('fluxDateToIso', () => {
  it('reads the declaration stamp as a Lisbon wall clock', () => {
    // WEST (+01:00) in July, WET (+00:00) in January
    expect(fluxDateToIso('2026-07-22 08:40')).toBe('2026-07-22T07:40:00.000Z')
    expect(fluxDateToIso('2026-01-15 18:05')).toBe('2026-01-15T18:05:00.000Z')
  })

  it('resolves the same instant whatever the device zone is', () => {
    for (const tz of ['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz
      expect(fluxDateToIso('2026-07-22 08:40')).toBe('2026-07-22T07:40:00.000Z')
    }
  })

  it('ignores anything that is not the expected shape', () => {
    expect(fluxDateToIso(undefined)).toBe(undefined)
    expect(fluxDateToIso('')).toBe(undefined)
    expect(fluxDateToIso('22/07/2026 08:40')).toBe(undefined)
    expect(fluxDateToIso(20260722)).toBe(undefined)
  })
})

describe('toPrice', () => {
  it('reads the flux’s decimal-comma prices, currency sign included', () => {
    expect(toPrice('1,729 €')).toBe(1.729)
    expect(toPrice('0,859 €')).toBe(0.859)
    expect(toPrice(1.5)).toBe(1.5)
  })

  it('returns undefined for anything unreadable', () => {
    expect(toPrice('')).toBe(undefined)
    expect(toPrice('n/d')).toBe(undefined)
    expect(toPrice(undefined)).toBe(undefined)
    expect(toPrice(Number.NaN)).toBe(undefined)
  })
})

describe('tidyBrand', () => {
  it('title-cases shouted banners but keeps short acronyms', () => {
    expect(tidyBrand('INTERMARCHÉ')).toBe('Intermarché')
    expect(tidyBrand('GALP')).toBe('Galp')
    expect(tidyBrand('BP')).toBe('BP')
    expect(tidyBrand('OZ Energia')).toBe('OZ Energia')
    expect(tidyBrand('Q8')).toBe('Q8')
  })

  it('reads « Genérico » as no banner at all', () => {
    expect(tidyBrand('Genérico')).toBe(undefined)
    expect(tidyBrand(undefined)).toBe(undefined)
  })
})

describe('groupStations', () => {
  it('groups rows by station id and maps products to fuels', () => {
    const stations = groupStations([
      row(67360, 'Gasóleo simples', '1,719 €'),
      row(67360, 'Gasolina simples 95', '1,729 €'),
      row(67360, 'GPL Auto', '0,859 €'),
    ])
    expect(stations).toHaveLength(1)
    const st = stations[0]
    expect(st.id).toBe('prt-67360')
    expect(st.name).toBe('Intermarche Vilar Formoso')
    expect(st.brand).toBe('Intermarché')
    expect(st.prices.diesel?.value).toBe(1.719)
    expect(st.prices.unleaded95?.value).toBe(1.729)
    expect(st.prices.lpg?.value).toBe(0.859)
    expect(st.prices.diesel?.updatedAt).toBe('2026-07-22T07:40:00.000Z')
    expect(st.city).toBe('Almeida')
    expect(st.postalCode).toBe('6355-289')
    expect(st.address).toBe('Sitio Da Represa')
    expect(st.highway).toBe(false)
    expect(st.hours).toBe(undefined)
    expect(st.tags).toEqual([])
    expect(st.services).toEqual([])
  })

  it('falls back to the « especial » grade when the plain one is not sold', () => {
    const stations = groupStations([
      row(1, 'Gasóleo especial', '1,829 €'),
      row(1, 'Gasolina especial 98', '1,999 €'),
    ])
    expect(stations[0].prices.diesel?.value).toBe(1.829)
    expect(stations[0].prices.unleaded98?.value).toBe(1.999)
    // …and never over the plain grade when both are declared
    const both = groupStations([
      row(2, 'Gasóleo simples', '1,719 €'),
      row(2, 'Gasóleo especial', '1,829 €'),
    ])
    expect(both[0].prices.diesel?.value).toBe(1.719)
  })

  it('exposes the other products as services and tags the additivated ones', () => {
    const stations = groupStations([
      row(1, 'Gasóleo simples', '1,719 €'),
      row(1, 'Gasóleo especial', '1,829 €'),
      row(1, 'Gasolina especial 95', '1,899 €'),
      row(1, 'Gasolina especial 98', '1,999 €'),
      row(1, 'Gasóleo colorido', '1,199 €'),
      row(1, 'GNL (gás natural liquefeito) - €/kg', '1,099 €'),
    ])
    // One entry per product id, in catalog order, whatever the row order
    expect(stations[0].services).toEqual([
      'dieselPremium',
      'petrolPremium',
      'agriculturalDiesel',
      'lng',
    ])
    expect(stations[0].tags).toEqual(['additives'])
  })

  it('reads the motorway flag from the station type', () => {
    const stations = groupStations([
      row(1, 'Gasóleo simples', '1,719 €', { TipoPosto: 'Auto-estrada' }),
    ])
    expect(stations[0].highway).toBe(true)
  })

  it('drops sellers with no road fuel and out-of-range prices', () => {
    expect(
      groupStations([
        // Heating oil only → not a fuel station
        row(20, 'Gasóleo de aquecimento', '1,099 €'),
        // A road fuel priced outside [0.5, 3.5] is not a price
        row(21, 'Gasóleo simples', '42,000 €'),
        row(22, 'Gasolina simples 95', '0,000 €'),
      ]),
    ).toEqual([])
  })

  it('ignores rows without an id, a name or usable coordinates', () => {
    const stations = groupStations([
      null,
      'nope',
      { Combustivel: 'Gasóleo simples', Preco: '1,719 €', Latitude: 40.6, Longitude: -6.8 },
      row(1, 'Gasóleo simples', '1,719 €', { Nome: '  ' }),
      row(2, 'Gasóleo simples', '1,719 €', { Latitude: null }),
      row(3, 'Gasóleo simples', '1,719 €', { Latitude: 91, Longitude: -6.8 }),
    ])
    expect(stations).toEqual([])
  })
})

describe('district coverage', () => {
  it('covers the mainland and nothing beyond it', () => {
    expect(prtCoversNear({ lat: 38.7223, lng: -9.1393 }, 5)).toBe(true) // Lisboa
    expect(prtCoversNear({ lat: 41.1496, lng: -8.611 }, 5)).toBe(true) // Porto
    expect(prtCoversNear({ lat: 37.0194, lng: -7.9304 }, 5)).toBe(true) // Faro
    // The flux stops at the mainland: Madeira, the Azores and inland Spain
    expect(prtCoversNear({ lat: 32.6669, lng: -16.9241 }, 20)).toBe(false)
    expect(prtCoversNear({ lat: 37.7412, lng: -25.6756 }, 20)).toBe(false)
    expect(prtCoversNear({ lat: 40.4168, lng: -3.7038 }, 20)).toBe(false)
  })

  it('reaches across the border from a Spanish town facing it', () => {
    // Badajoz sits ~5 km from the Portuguese line — its zone must query
    expect(prtCoversNear({ lat: 38.8794, lng: -6.9707 }, 15)).toBe(true)
  })
})

// ── District memo ────────────────────────────────────────────────────────────
// A district payload weighs a few hundred KB, so overlapping callers must
// share the in-flight request instead of each downloading their own copy.
const LISBOA: GeoPoint = { lat: 38.7223, lng: -9.1393 }
const BODY = { status: true, resultado: [row(67360, 'Gasóleo simples', '1,719 €')] }

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
  const mod = await import('./PrtStationsProvider')
  return new mod.PrtStationsProvider()
}

describe('district fetch memo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands the in-flight request to a concurrent caller', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(LISBOA, 5)
    const issued = mock.mock.calls.length
    expect(issued).toBeGreaterThan(0)
    const second = provider.getStationsNear(LISBOA, 5)

    expect(mock.mock.calls.length).toBe(issued)
    const urls = mock.mock.calls.map((c) => c[0])
    expect(new Set(urls).size).toBe(urls.length)

    await settleAll()
    expect(await first).toEqual(await second)
  })

  it('reuses the memo once the response has landed', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(LISBOA, 5)
    await settleAll()
    await first
    const issued = mock.mock.calls.length

    await provider.getStationsNear(LISBOA, 5)
    expect(mock.mock.calls.length).toBe(issued)
  })

  it('evicts a failed fetch so the next query retries', async () => {
    const provider = await freshProvider()
    const { mock, settleAll } = deferredFetch()

    const first = provider.getStationsNear(LISBOA, 5)
    const issued = mock.mock.calls.length
    await settleAll(true)
    await expect(first).rejects.toThrow()

    const second = provider.getStationsNear(LISBOA, 5)
    expect(mock.mock.calls.length).toBe(issued * 2)
    await settleAll()
    await second
  })

  it('rejects a 200 response the API marks as failed', async () => {
    const provider = await freshProvider()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ ok: true, status: 200, json: async () => ({ status: false, mensagem: 'erro' }) }) as Response,
      ),
    )
    await expect(provider.getStationsNear(LISBOA, 5)).rejects.toThrow(/rejected/)
  })
})
