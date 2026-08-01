import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALL_FUELS } from '../data/types'
import { nextFuelAfter, toggleBrandIn, toggleFavoriteIn, type FavoriteStation } from './store'

const station = (id: string): FavoriteStation => ({
  id,
  name: `Station ${id}`,
  init: id.slice(0, 2).toUpperCase(),
  lat: 43.6,
  lng: 1.44,
})

describe('toggleFavoriteIn', () => {
  it('pins a station that is not starred yet', () => {
    expect(toggleFavoriteIn([], station('a')).map((f) => f.id)).toEqual(['a'])
  })

  it('unpins a station that is already starred', () => {
    const prev = [station('a'), station('b')]
    expect(toggleFavoriteIn(prev, station('a')).map((f) => f.id)).toEqual(['b'])
  })

  it('leaves the previous list untouched', () => {
    const prev = [station('a')]
    toggleFavoriteIn(prev, station('b'))
    expect(prev.map((f) => f.id)).toEqual(['a'])
  })
})

describe('nextFuelAfter', () => {
  it('cycles through every fuel and wraps around', () => {
    let cur = ALL_FUELS[0]
    const seen = ALL_FUELS.map(() => (cur = nextFuelAfter(cur)))
    expect(seen).toEqual([...ALL_FUELS.slice(1), ALL_FUELS[0]])
  })
})

describe('toggleBrandIn', () => {
  it('selects a brand that is not in the filter', () => {
    expect(toggleBrandIn(['TotalEnergies'], 'Leclerc')).toEqual(['TotalEnergies', 'Leclerc'])
  })

  it('deselects a brand already in the filter', () => {
    expect(toggleBrandIn(['TotalEnergies', 'Leclerc'], 'TotalEnergies')).toEqual(['Leclerc'])
  })

  it('leaves the previous selection untouched', () => {
    const prev = ['TotalEnergies']
    toggleBrandIn(prev, 'Leclerc')
    expect(prev).toEqual(['TotalEnergies'])
  })
})

// ── Purity ───────────────────────────────────────────────────────────────────
// These feed `useState` updaters, which React may invoke more than once
// for a single call — StrictMode does it deliberately, and the same guarantee
// is what lets React discard and replay a render. So they must return the same
// value every time and never write anything, persistence included.
describe('state updaters stay pure', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('write nothing to localStorage, however often they run', () => {
    const setItem = vi.fn()
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() },
      configurable: true,
    })

    const run = () => [
      toggleFavoriteIn([station('a')], station('b')).map((f) => f.id),
      nextFuelAfter('diesel'),
      toggleBrandIn(['TotalEnergies'], 'Leclerc'),
    ]

    // A double invocation is indistinguishable from a single one
    expect(run()).toEqual(run())
    expect(setItem).not.toHaveBeenCalled()
  })
})
