import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotonGeocodeProvider } from './PhotonGeocodeProvider'

// Photon answers GeoJSON: one feature per hit, `type` saying what it denotes
// and `countrycode` where it is.
const feature = (
  properties: Record<string, unknown>,
  coordinates: [number, number] = [-8.4294632, 40.2111931],
) => ({ properties: { countrycode: 'PT', ...properties }, geometry: { coordinates } })

function stubFetch(features: unknown[]) {
  const mock = vi.fn(
    async (_url: string) => ({ ok: true, status: 200, json: async () => ({ features }) }) as Response,
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const provider = new PhotonGeocodeProvider()

describe('PhotonGeocodeProvider', () => {
  it('asks Photon for the mainland box the price flux covers', async () => {
    const mock = stubFetch([])
    await provider.search('coimbra')
    const url = String(mock.mock.calls[0][0])
    expect(url).toContain('q=coimbra')
    expect(url).toContain('bbox=-9.6%2C36.9%2C-6.1%2C42.2')
  })

  it('does not query on a query too short to mean anything', async () => {
    const mock = stubFetch([])
    expect(await provider.search('co')).toEqual([])
    expect(mock).not.toHaveBeenCalled()
  })

  it('ranks the town above its streets and house numbers', async () => {
    stubFetch([
      feature({ name: 'Rua de Coimbra', type: 'street', city: 'Lisboa', county: 'Lisboa' }),
      feature({ name: 'Coimbra-B', type: 'house', city: 'Coimbra', county: 'Coimbra' }),
      feature({ name: 'Coimbra', type: 'city', county: 'Coimbra' }),
    ])
    const out = await provider.search('coimbra')
    expect(out.map((r) => [r.label, r.kind])).toEqual([
      ['Coimbra', 'locality'],
      ['Rua de Coimbra', 'street'],
      ['Coimbra-B', 'address'],
    ])
  })

  it('names the district, and lets the view name the country', async () => {
    stubFetch([
      feature({ name: 'Coimbra', type: 'city', county: 'Coimbra' }),
      feature({ name: 'Rua Augusta', type: 'street', city: 'Lisboa', county: 'Lisboa' }),
      feature({ name: 'Amadora', type: 'city', city: 'Amadora', county: 'Lisboa' }),
    ])
    const out = await provider.search('qualquer')
    // A place naming its own district says nothing more than the country
    expect(out.map((r) => [r.label, r.sublabel, r.country])).toEqual([
      ['Coimbra', '', 'pt'],
      ['Amadora', 'Lisboa', 'pt'],
      ['Rua Augusta', 'Lisboa', 'pt'],
    ])
  })

  it('builds the label of a numbered address the source does not name', async () => {
    stubFetch([feature({ type: 'house', housenumber: '12', street: 'Rua Augusta', city: 'Lisboa' })])
    expect((await provider.search('rua augusta 12'))[0].label).toBe('12 Rua Augusta')
  })

  it('drops what is not a place in Portugal', async () => {
    stubFetch([
      // The box overlaps Spain, and boundaries are not somewhere to drive to
      feature({ name: 'Porto', type: 'city', county: 'Zamora', countrycode: 'ES' }),
      feature({ name: 'Porto', type: 'county' }),
      feature({ name: 'Norte', type: 'state' }),
      feature({ name: 'Portugal', type: 'country' }),
      feature({ type: 'city' }), // nothing to show for it
      feature({ name: 'Sem sítio', type: 'city' }, [Number.NaN, Number.NaN]),
    ])
    expect(await provider.search('porto')).toEqual([])
  })

  it('folds the segments OSM splits a long street into', async () => {
    stubFetch([
      feature({ name: 'Rua Augusta', type: 'street', city: 'Lisboa', county: 'Lisboa' }),
      feature({ name: 'Rua Augusta', type: 'street', city: 'Lisboa', county: 'Lisboa' }),
    ])
    expect(await provider.search('rua augusta')).toHaveLength(1)
  })

  it('reports a refusal instead of pretending the search found nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response),
    )
    await expect(provider.search('coimbra')).rejects.toThrow(/429/)
  })
})
