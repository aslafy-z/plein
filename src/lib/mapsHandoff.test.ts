import { describe, expect, it } from 'vitest'
import type { Station } from '../data/types'
import { mapsHandoffUrl } from './mapsHandoff'

// 65 ROUTE D AGDE: the gouv flux puts it at 43.628, 1.48, some 370 m off
// the TotalEnergies pumps OSM has at 43.62633, 1.47603
const feed: Station = {
  id: 'fr-31000004',
  name: 'TotalEnergies · Balma',
  init: 'TO',
  brand: 'TotalEnergies',
  lat: 43.628,
  lng: 1.48,
  address: '65 ROUTE D AGDE',
  city: 'Balma',
  postalCode: '31000',
  prices: {},
  tags: [],
  services: [],
  highway: false,
}
const forecourt: Station = { ...feed, lat: 43.62633, lng: 1.47603, positionFromPoi: true }
const query = encodeURIComponent('TotalEnergies 65 ROUTE D AGDE 31000 Balma')

describe('mapsHandoffUrl', () => {
  it('hands every app the point of a station sitting on its OSM forecourt', () => {
    expect(mapsHandoffUrl('google', forecourt)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=43.62633,1.47603&travelmode=driving',
    )
    expect(mapsHandoffUrl('waze', forecourt)).toBe(
      'https://www.waze.com/ul?ll=43.62633%2C1.47603&navigate=yes',
    )
    expect(mapsHandoffUrl('apple', forecourt)).toBe(
      'https://maps.apple.com/?daddr=43.62633,1.47603&dirflg=d',
    )
    expect(mapsHandoffUrl('osm', forecourt)).toBe(
      'https://www.openstreetmap.org/directions?to=43.62633%2C1.47603',
    )
    expect(mapsHandoffUrl('android', forecourt)).toBe(
      `geo:43.62633,1.47603?q=43.62633,1.47603(${encodeURIComponent('TotalEnergies · Balma')})`,
    )
  })

  it("searches by name when the point is only the source's geocode", () => {
    expect(mapsHandoffUrl('google', feed)).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`,
    )
    expect(mapsHandoffUrl('waze', feed)).toBe(`https://www.waze.com/ul?q=${query}&navigate=yes`)
  })

  it('anchors the name search on the point where the app can', () => {
    expect(mapsHandoffUrl('apple', feed)).toBe(
      `https://maps.apple.com/?daddr=${query}&sll=43.628,1.48&dirflg=d`,
    )
    expect(mapsHandoffUrl('android', feed)).toBe(`geo:43.628,1.48?q=${query}`)
  })

  it('always gives OpenStreetMap the point: its geocoder finds no brand', () => {
    expect(mapsHandoffUrl('osm', feed)).toBe(
      'https://www.openstreetmap.org/directions?to=43.628%2C1.48',
    )
  })

  it('keeps the point when there is nothing to search for', () => {
    const coords = 'https://www.google.com/maps/dir/?api=1&destination=43.628,1.48&travelmode=driving'
    expect(mapsHandoffUrl('google', { ...feed, brand: undefined })).toBe(coords)
    expect(mapsHandoffUrl('google', { ...feed, address: '' })).toBe(coords)
    expect(mapsHandoffUrl('android', { ...feed, brand: undefined, name: 'Station · Balma' })).toBe(
      `geo:43.628,1.48?q=43.628,1.48(${encodeURIComponent('Station · Balma')})`,
    )
  })
})
