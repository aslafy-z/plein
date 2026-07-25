import { describe, expect, it } from 'vitest'
import { placeSublabel } from './labels'
import type { GeocodeResult } from '../data/types'

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
    expect(placeSublabel(at({ label: 'el Pas de la Casa', sublabel: 'Encamp', country: 'and' })))
      .toBe('Andorre · Encamp')
  })

  it('falls back to the country alone when the parish adds nothing', () => {
    expect(placeSublabel(at({ label: 'Encamp', sublabel: '', country: 'and' }))).toBe('Andorre')
  })
})
