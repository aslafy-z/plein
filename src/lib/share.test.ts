import { describe, expect, it } from 'vitest'
import { mapViewShareData, stationShareData } from './share'
import type { MapUrlView } from './mapUrl'

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
    expect(d.title).toBe('Plein. — Station U · Croix-Blanche')
    expect(d.text).toBe('Station U · Croix-Blanche (Toulouse) — Gazole à 1,68 €/L sur Plein.')
  })

  it('stays readable without a price or a city', () => {
    const d = stationShareData({ id: 'su', name: 'Station U' }, 'https://plein.app')
    expect(d.text).toBe('Station U sur Plein.')
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
    expect(d.title).toBe('Plein. — E85 autour de Toulouse')
    expect(d.text).toBe('Les prix du E85 autour de Toulouse sur Plein.')
  })

  it('falls back on the zone after a free pan', () => {
    const d = mapViewShareData(VIEW, 'https://plein.app/', { fuelLabel: 'Gazole', place: null })
    expect(d.text).toBe('Les prix du Gazole dans cette zone sur Plein.')
    expect(d.url).toBe('https://plein.app/?ll=43.6047,1.4442&z=14&f=diesel&r=5')
  })
})
