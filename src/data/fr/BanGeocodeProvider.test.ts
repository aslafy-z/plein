import { afterEach, describe, expect, it, vi } from 'vitest'
import { BanGeocodeProvider } from './BanGeocodeProvider'

const feature = (label: string, type: string, extra: Record<string, unknown> = {}) => ({
  properties: { label, type, context: '64, Pyrénées-Atlantiques, Nouvelle-Aquitaine', ...extra },
  geometry: { coordinates: [-1.466564, 43.488544] },
})

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

const provider = new BanGeocodeProvider()

describe('BanGeocodeProvider', () => {
  it('asks the address index of the Géoplateforme geocoder', async () => {
    const mock = stubFetch([])
    await provider.search('bayonne')
    const url = String(mock.mock.calls[0][0])
    expect(url).toContain('/geocodage/search?')
    expect(url).toContain('q=bayonne')
    expect(url).toContain('index=address')
  })

  it('does not query on a query too short to mean anything', async () => {
    const mock = stubFetch([])
    expect(await provider.search('ba')).toEqual([])
    expect(mock).not.toHaveBeenCalled()
  })

  it('ranks the town above its streets and house numbers', async () => {
    stubFetch([
      feature('12 Rue de Bayonne 31300 Toulouse', 'housenumber'),
      feature('Rue de Bayonne 31300 Toulouse', 'street'),
      feature('Bayonne', 'municipality'),
    ])
    const out = await provider.search('bayonne')
    expect(out.map((r) => r.kind)).toEqual(['locality', 'street', 'address'])
    expect(out[0]).toEqual({
      label: 'Bayonne',
      sublabel: '64, Pyrénées-Atlantiques, Nouvelle-Aquitaine',
      point: { lat: 43.488544, lng: -1.466564 },
      kind: 'locality',
    })
  })

  it('reports a refusal instead of pretending the search found nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response),
    )
    await expect(provider.search('bayonne')).rejects.toThrow(/503/)
  })
})
