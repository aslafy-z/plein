import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHOTON_ANDORRA, PHOTON_FRANCE, PHOTON_SPAIN, PhotonGeocodeProvider } from './PhotonGeocodeProvider'

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

  it('ranks the town, then its points of interest, streets and house numbers', async () => {
    stubFetch([
      feature({ name: 'Rua de Coimbra', type: 'street', city: 'Lisboa', county: 'Lisboa' }),
      feature({ name: 'Coimbra-B', type: 'house', city: 'Coimbra', county: 'Coimbra' }),
      feature({ type: 'house', housenumber: '3', street: 'Rua de Coimbra', city: 'Lisboa' }),
      feature({ name: 'Coimbra', type: 'city', county: 'Coimbra' }),
    ])
    const out = await provider.search('coimbra')
    expect(out.map((r) => [r.label, r.kind])).toEqual([
      ['Coimbra', 'locality'],
      ['Coimbra-B', 'poi'],
      ['Rua de Coimbra', 'street'],
      ['3 Rua de Coimbra', 'address'],
    ])
  })

  it('keeps the station and drops the stops and entrances mapped around it', async () => {
    const at = { type: 'house', city: 'Lisboa', county: 'Lisboa' }
    stubFetch([
      feature({ ...at, name: 'Aeroporto', osm_key: 'railway', osm_value: 'stop' }),
      feature({ ...at, name: 'Aeroporto', osm_key: 'railway', osm_value: 'subway_entrance' }),
      feature({ ...at, name: 'Avenida de Berlim', osm_key: 'highway', osm_value: 'bus_stop' }),
      feature({ ...at, name: 'Aeroporto', osm_key: 'railway', osm_value: 'station' }),
      feature({ ...at, name: 'Aeroporto Humberto Delgado', osm_key: 'aeroway', osm_value: 'aerodrome' }),
    ])
    const out = await provider.search('aeroporto lisboa')
    expect(out.map((r) => [r.label, r.kind])).toEqual([
      ['Aeroporto', 'poi'],
      ['Aeroporto Humberto Delgado', 'poi'],
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

  it('asks once more when the connection is dropped, and only then', async () => {
    const answer = { ok: true, status: 200, json: async () => ({ features: [feature({ name: 'Coimbra', type: 'city' })] }) }
    const dropped = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(answer as unknown as Response)
    vi.stubGlobal('fetch', dropped)
    expect((await provider.search('coimbra')).map((r) => r.label)).toEqual(['Coimbra'])
    expect(dropped).toHaveBeenCalledTimes(2)

    const timedOut = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    vi.stubGlobal('fetch', timedOut)
    await expect(provider.search('coimbra')).rejects.toThrow('timed out')
    expect(timedOut).toHaveBeenCalledTimes(1)
  })

  it('answers for France when asked to: its own box, and the commune in the context', async () => {
    const mock = stubFetch([
      feature({
        countrycode: 'FR',
        type: 'house',
        housenumber: '4',
        street: 'Rue Pasteur',
        postcode: '06000',
        city: 'Nice',
        county: 'Alpes-Maritimes',
      }),
      feature({ countrycode: 'FR', type: 'city', name: 'Nice', postcode: '06000', county: 'Alpes-Maritimes' }),
      feature({ countrycode: 'IT', type: 'city', name: 'Nizza Monferrato' }),
    ])
    const out = await new PhotonGeocodeProvider(PHOTON_FRANCE).search('nice')
    expect(String(mock.mock.calls[0][0])).toContain('bbox=-5.3%2C41.2%2C9.7%2C51.2')
    expect(out.map((r) => [r.label, r.sublabel, r.country])).toEqual([
      ['Nice', 'Alpes-Maritimes', undefined],
      ['4 Rue Pasteur', '06000 Nice, Alpes-Maritimes', undefined],
    ])
  })

  it('answers for Spain and for Andorra, each in its own box', async () => {
    let mock = stubFetch([
      feature({
        countrycode: 'ES',
        type: 'house',
        housenumber: '3',
        street: 'Calle Mayor',
        postcode: '28013',
        city: 'Madrid',
      }),
      feature({ countrycode: 'PT', type: 'city', name: 'Madrid' }),
    ])
    const es = await new PhotonGeocodeProvider(PHOTON_SPAIN).search('calle mayor 3 madrid')
    expect(String(mock.mock.calls[0][0])).toContain('bbox=-9.4%2C35.9%2C4.4%2C43.9')
    expect(es.map((r) => [r.label, r.sublabel, r.country])).toEqual([
      ['3 Calle Mayor', '28013 Madrid', undefined],
    ])

    mock = stubFetch([
      feature({ countrycode: 'AD', type: 'street', name: 'Avinguda Meritxell', city: 'Andorra la Vella' }),
      feature({ countrycode: 'ES', type: 'city', name: 'La Seu d\'Urgell' }),
    ])
    const ad = await new PhotonGeocodeProvider(PHOTON_ANDORRA).search('avinguda meritxell')
    expect(String(mock.mock.calls[0][0])).toContain('bbox=1.40%2C42.42%2C1.79%2C42.66')
    expect(ad.map((r) => [r.label, r.sublabel, r.country])).toEqual([
      ['Avinguda Meritxell', 'Andorra la Vella', 'ad'],
    ])
  })
})
