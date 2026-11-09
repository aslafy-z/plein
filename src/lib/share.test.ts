import { describe, expect, it } from 'vitest'
import CA from '../../messages/ca.json?raw'
import EN from '../../messages/en.json?raw'
import ES from '../../messages/es.json?raw'
import FR from '../../messages/fr.json?raw'
import PT from '../../messages/pt.json?raw'
import { m } from '../paraglide/messages.js'
import { fmtPrice } from './format'
import { mapViewShareData, routeShareData, stationShareData } from './share'
import type { MapUrlView } from './mapUrl'
import type { RouteUrlView } from './routeUrl'

// The wording is catalog copy: the assertions read it back through the same
// message functions (no locale is set, so that is the base locale, French)
// instead of pinning sentences that belong to `messages/`.

describe('stationShareData', () => {
  it('links to the /station/:id deep link the app boots on', () => {
    const d = stationShareData({ id: 'fr-31000001', name: 'Station U' }, 'https://plein.app')
    expect(d.url).toBe('https://plein.app/station/fr-31000001')
  })

  it('drops a trailing slash on the origin', () => {
    const d = stationShareData({ id: 'su', name: 'Station U' }, 'http://localhost:5173/')
    expect(d.url).toBe('http://localhost:5173/station/su')
  })

  it('escapes ids so an odd one cannot break the path', () => {
    const d = stationShareData({ id: 'a b/c', name: 'X' }, 'https://plein.app')
    expect(d.url).toBe('https://plein.app/station/a%20b%2Fc')
  })

  it('mentions the city and the priced fuel when both are known', () => {
    const d = stationShareData(
      { id: 'su', name: 'Station U · Croix-Blanche', city: 'Toulouse' },
      'https://plein.app',
      { fuelLabel: 'Gazole', value: 1.679 },
    )
    expect(d.title).toBe(m.share_station_title({ name: 'Station U · Croix-Blanche' }))
    expect(d.text).toBe(
      m.share_station_priced_city({
        name: 'Station U · Croix-Blanche',
        city: 'Toulouse',
        fuel: 'Gazole',
        price: fmtPrice(1.679),
      }),
    )
    // The price is formatted by `Intl`, the rest of the sentence by the catalog
    expect(d.text).toContain('Toulouse')
    expect(d.text).toContain('Gazole')
    expect(d.text).toContain('1,68')
  })

  it('has a whole sentence for each of city × price', () => {
    const origin = 'https://plein.app'
    const price = { fuelLabel: 'Gazole', value: 1.679 }
    expect(stationShareData({ id: 'su', name: 'Station U' }, origin, price).text).toBe(
      m.share_station_priced({ name: 'Station U', fuel: 'Gazole', price: fmtPrice(1.679) }),
    )
    expect(stationShareData({ id: 'su', name: 'Station U', city: 'Toulouse' }, origin).text).toBe(
      m.share_station_plain_city({ name: 'Station U', city: 'Toulouse' }),
    )
  })

  it('stays readable without a price or a city', () => {
    const d = stationShareData({ id: 'su', name: 'Station U' }, 'https://plein.app')
    expect(d.text).toBe(m.share_station_plain({ name: 'Station U' }))
  })
})

describe('mapViewShareData', () => {
  const VIEW: MapUrlView = {
    center: { lat: 43.6047, lng: 1.4442 },
    zoom: 14,
    fuel: 'diesel',
    radius: 5,
    brands: [],
    services: [],
  }

  it('links to the map view itself, filters included', () => {
    const d = mapViewShareData({ ...VIEW, services: ['open24h'] }, 'https://plein.app', {
      fuelLabel: 'Gazole',
    })
    expect(d.url).toBe('https://plein.app/?ll=43.6047,1.4442&z=14&f=diesel&r=5&s=open24h')
  })

  it('names the searched place when there is one', () => {
    const d = mapViewShareData(VIEW, 'https://plein.app', {
      fuelLabel: 'E85',
      place: 'Toulouse',
    })
    expect(d.title).toBe(m.share_map_around_title({ fuel: 'E85', place: 'Toulouse' }))
    expect(d.text).toBe(m.share_map_around({ fuel: 'E85', place: 'Toulouse' }))
    expect(d.text).toContain('Toulouse')
  })

  it('falls back on the zone after a free pan', () => {
    const d = mapViewShareData(VIEW, 'https://plein.app/', { fuelLabel: 'Gazole', place: null })
    expect(d.title).toBe(m.share_map_area_title({ fuel: 'Gazole' }))
    expect(d.text).toBe(m.share_map_area({ fuel: 'Gazole' }))
    expect(d.url).toBe('https://plein.app/?ll=43.6047,1.4442&z=14&f=diesel&r=5')
  })
})

describe('routeShareData', () => {
  it('names both endpoints as displayed and opens on the results', () => {
    // No endpoint to encode: the wording is what this test is about, and the
    // query string has its own tests in `routeUrl.test.ts`
    const view = {
      fromPoint: null,
      fromLabel: '',
      fromIsCurrentPosition: true,
      toPoint: null,
      toLabel: '',
    } as RouteUrlView
    const d = routeShareData(view, 'https://plein.app/', {
      from: 'Toulouse',
      to: 'Bordeaux',
    })
    expect(d.title).toBe(m.share_route_title({ from: 'Toulouse', to: 'Bordeaux' }))
    expect(d.text).toBe(m.share_route({ from: 'Toulouse', to: 'Bordeaux' }))
    expect(d.url).toBe('https://plein.app/route/results')
  })
})

describe('share_* catalog keys', () => {
  const shape = (raw: string) =>
    Object.entries(JSON.parse(raw) as Record<string, string>)
      .filter(([key]) => key.startsWith('share_'))
      .map(([key, text]) => [key, [...text.matchAll(/\{(\w+)\}/g)].map((p) => p[1]).sort()])

  it('carry the same keys and parameters in every locale', () => {
    const source = shape(FR)
    expect(source.length).toBeGreaterThan(0)
    for (const raw of [EN, ES, CA, PT]) expect(shape(raw)).toEqual(source)
  })
})
