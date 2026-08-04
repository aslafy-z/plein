import { describe, expect, it } from 'vitest'
import { placeSublabel, serviceLabel, serviceTagLabel } from './labels'
import { SERVICE_TAGS, type GeocodeResult } from '../data/types'

// No locale is set, so the assertions read the base locale (French).

const at = (extra: Partial<GeocodeResult>): GeocodeResult => ({
  label: 'Somewhere',
  sublabel: '',
  point: { lat: 42.5, lng: 1.5 },
  kind: 'locality',
  ...extra,
})

describe('placeSublabel', () => {
  it('passes a source-written sublabel straight through', () => {
    expect(placeSublabel(at({ label: 'Toulouse', sublabel: 'Haute-Garonne' }))).toBe('Haute-Garonne')
  })

  it('names the country the Andorran flux leaves out', () => {
    expect(placeSublabel(at({ label: 'el Pas de la Casa', sublabel: 'Encamp', country: 'ad' })))
      .toBe('Andorre · Encamp')
  })

  it('falls back to the country alone when the parish adds nothing', () => {
    expect(placeSublabel(at({ label: 'Encamp', sublabel: '', country: 'ad' }))).toBe('Andorre')
  })
})

describe('serviceTagLabel', () => {
  it('names every tag, so a new one cannot reach the UI unlabelled', () => {
    for (const tag of SERVICE_TAGS) expect(serviceTagLabel(tag)).toBeTruthy()
  })

  it('spells AdBlue the way the product chip does', () => {
    // The tag and the product id are the same word — one catalog entry, and
    // the filter pill must not drift from the fiche chip
    expect(serviceTagLabel('adBlue')).toBe('AdBlue')
    expect(serviceLabel('adBlue')).toBe('AdBlue')
  })
})
