import { describe, expect, it } from 'vitest'
import { foldRecentsIntoSearchHistory } from './persist'
import type { SearchedPlace } from './persist'

// The route's own « Récents » store is gone — a blob written by an older build
// folds its entries into the one search history on the way in, so nothing the
// user remembered is lost.

const searched = (label: string, at: number): SearchedPlace => ({
  label,
  sublabel: 'Gironde',
  point: { lat: 44.84, lng: -0.58 },
  kind: 'locality',
  at,
})

describe('foldRecentsIntoSearchHistory', () => {
  it('appends legacy trips under the real searches, with at = 0', () => {
    const history = [searched('Annecy', 1_700_000_000_000)]
    const out = foldRecentsIntoSearchHistory(
      [{ label: 'Montpellier', sublabel: 'Hérault', point: { lat: 43.61, lng: 3.88 } }],
      history,
    )
    expect(out.map((p) => p.label)).toEqual(['Annecy', 'Montpellier'])
    expect(out[1]).toMatchObject({ sublabel: 'Hérault', at: 0, kind: 'other' })
  })

  it('keeps the real entry when both stores remembered the same place', () => {
    const history = [searched('Montpellier', 1_700_000_000_000)]
    const out = foldRecentsIntoSearchHistory(
      [{ label: 'Montpellier', point: { lat: 0, lng: 0 } }],
      history,
    )
    expect(out).toHaveLength(1)
    expect(out[0].at).toBe(1_700_000_000_000)
  })

  it('drops malformed entries instead of storing them', () => {
    const out = foldRecentsIntoSearchHistory(
      [
        { label: 'No point' },
        { point: { lat: 1, lng: 2 } },
        { label: 'Bad point', point: { lat: 'x', lng: 2 } },
        'not even an object',
      ],
      [],
    )
    expect(out).toEqual([])
  })

  it('leaves the history alone when the blob holds no recents', () => {
    const history = [searched('Annecy', 1)]
    expect(foldRecentsIntoSearchHistory(undefined, history)).toBe(history)
    expect(foldRecentsIntoSearchHistory('junk', history)).toBe(history)
  })
})
