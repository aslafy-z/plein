import { describe, expect, it } from 'vitest'
import type { Station } from '../data/types'
import { desktopMapsUrl } from './store'

const esso: Station = {
  id: 'fr-31500007',
  name: 'Esso · Toulouse',
  init: 'ES',
  brand: 'Esso',
  lat: 43.6255,
  lng: 1.4612,
  address: '231 FAUBOURG BONNEFOY',
  city: 'Toulouse',
  postalCode: '31500',
  prices: {},
  tags: [],
  services: [],
  highway: false,
}

const coords = 'https://www.google.com/maps/dir/?api=1&destination=43.6255,1.4612&travelmode=driving'

describe('desktopMapsUrl', () => {
  it('routes Google to the point of a station sitting on its OSM forecourt', () => {
    // A brand + address search would stop on « Did you mean » when Google
    // knows the place under two names
    expect(desktopMapsUrl('google', { ...esso, positionFromPoi: true })).toBe(coords)
  })

  it("searches Google by name when the point is only the source's geocode", () => {
    expect(desktopMapsUrl('google', esso)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=' +
        encodeURIComponent('Esso 231 FAUBOURG BONNEFOY 31500 Toulouse') +
        '&travelmode=driving',
    )
  })

  it('keeps the point when there is nothing to search for', () => {
    // « Station » or a bare city would be a lottery
    expect(desktopMapsUrl('google', { ...esso, brand: undefined })).toBe(coords)
    expect(desktopMapsUrl('google', { ...esso, address: '' })).toBe(coords)
  })

  it('always gives the other sites the point', () => {
    expect(desktopMapsUrl('waze', esso)).toBe(
      'https://www.waze.com/ul?ll=43.6255%2C1.4612&navigate=yes',
    )
    expect(desktopMapsUrl('osm', esso)).toBe(
      'https://www.openstreetmap.org/directions?to=43.6255%2C1.4612',
    )
  })
})
