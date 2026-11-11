import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeopfPoiGeocodeProvider } from './GeopfPoiGeocodeProvider'

// The Géoplateforme answers GeoJSON, most properties as arrays.
const feature = (
  properties: Record<string, unknown>,
  coordinates: [number, number] = [1.366813, 43.630741],
) => ({ properties, geometry: { coordinates } })

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

const provider = new GeopfPoiGeocodeProvider()

describe('GeopfPoiGeocodeProvider', () => {
  it('asks the poi index', async () => {
    const mock = stubFetch([])
    await provider.search('gare matabiau')
    const url = String(mock.mock.calls[0][0])
    expect(url).toContain('q=gare+matabiau')
    expect(url).toContain('index=poi')
  })

  it('does not query on a query too short to mean anything', async () => {
    const mock = stubFetch([])
    expect(await provider.search('ga')).toEqual([])
    expect(mock).not.toHaveBeenCalled()
  })

  it('returns a point of interest with its postcode and commune', async () => {
    stubFetch([
      feature({
        toponym: 'Aéroport de Toulouse-Blagnac',
        category: ['aérodrome', 'transport'],
        postcode: ['31700'],
        city: ['Blagnac'],
        score: 0.85,
      }),
    ])
    expect(await provider.search('aeroport de toul')).toEqual([
      {
        label: 'Aéroport de Toulouse-Blagnac',
        sublabel: '31700 Blagnac',
        point: { lat: 43.630741, lng: 1.366813 },
        kind: 'poi',
      },
    ])
  })

  it('leaves communes and lieux-dits to the address geocoder', async () => {
    stubFetch([
      feature({ toponym: 'Toulouse', category: ['administratif', 'commune'], postcode: ['31000'] }),
      feature({ toponym: 'Toulouse', category: ['lieu-dit habité', "zone d'habitation"] }),
      feature({ toponym: 'Toulouse', category: ['lieu-dit non habité'] }),
      feature({ toponym: 'Gare Matabiau', category: ['gare voyageurs uniquement'], city: ['Toulouse'] }),
    ])
    const out = await provider.search('toulouse')
    expect(out.map((r) => r.label)).toEqual(['Gare Matabiau'])
    expect(out[0].sublabel).toBe('Toulouse')
  })

  it('drops stray matches, nameless features and broken geometries', async () => {
    stubFetch([
      feature({ toponym: "Château d'eau", category: ["château d'eau"], score: 0.2 }),
      feature({ category: ['stade'] }),
      feature({ toponym: 'Stade', category: ['stade'] }, [Number.NaN, Number.NaN]),
    ])
    expect(await provider.search('chateau de chambord')).toEqual([])
  })

  it('folds the features one bridge is drawn as', async () => {
    const pont = { toponym: 'Pont', category: ['pont'], postcode: ['30210'], city: ['Vers-Pont-du-Gard'] }
    stubFetch([feature(pont), feature(pont), feature(pont)])
    expect(await provider.search('pont du gard')).toHaveLength(1)
  })

  it('reports a refusal instead of pretending the search found nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response),
    )
    await expect(provider.search('gare matabiau')).rejects.toThrow(/429/)
  })
})
