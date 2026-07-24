import { describe, expect, it } from 'vitest'
import { stationShareData } from './share'

describe('stationShareData', () => {
  it('links to the /station/:id deep link the app boots on', () => {
    const d = stationShareData({ id: 'fra-31000001', name: 'Station U' }, 'https://plein.app')
    expect(d.url).toBe('https://plein.app/station/fra-31000001')
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
