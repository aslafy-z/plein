import { describe, expect, it } from 'vitest'
import type { GeocodeResult } from '../data/types'
import type { SearchedPlace } from './persist'
import { MAX_SEARCH_HISTORY, pushSearchIn, searchRows } from './searchHistory'

const place = (label: string, kind: GeocodeResult['kind'] = 'locality'): GeocodeResult => ({
  label,
  sublabel: 'Haute-Garonne',
  point: { lat: 43.6, lng: 1.44 },
  kind,
})

const searched = (label: string, at: number): SearchedPlace => ({ ...place(label), at })

const labels = (rows: { place: GeocodeResult }[]) => rows.map((row) => row.place.label)

describe('pushSearchIn', () => {
  it('remembers a place at the top of the history', () => {
    expect(pushSearchIn([searched('Albi', 1)], place('Pau'), 2).map((p) => p.label)).toEqual([
      'Pau',
      'Albi',
    ])
  })

  it('stamps the entry with the time it was picked', () => {
    expect(pushSearchIn([], place('Pau'), 1234)[0].at).toBe(1234)
  })

  it('moves a place searched again back to the top instead of duplicating it', () => {
    const prev = [searched('Albi', 2), searched('Pau', 1)]
    expect(pushSearchIn(prev, place('Pau'), 3).map((p) => p.label)).toEqual(['Pau', 'Albi'])
  })

  it('treats accents and case as the same place', () => {
    const prev = [searched('Nîmes', 1)]
    expect(pushSearchIn(prev, place('NIMES'), 2).map((p) => p.label)).toEqual(['NIMES'])
  })

  it('drops the oldest entries past the cap', () => {
    const prev = Array.from({ length: MAX_SEARCH_HISTORY }, (_, i) => searched(`p${i}`, i))
    const next = pushSearchIn(prev, place('Pau'), 99)
    expect(next).toHaveLength(MAX_SEARCH_HISTORY)
    expect(next[next.length - 1].label).toBe(`p${MAX_SEARCH_HISTORY - 2}`)
  })

  it('leaves the previous history untouched', () => {
    const prev = [searched('Albi', 1)]
    pushSearchIn(prev, place('Pau'), 2)
    expect(prev.map((p) => p.label)).toEqual(['Albi'])
  })
})

describe('searchRows', () => {
  it('offers the whole history, most recent first, on an empty query', () => {
    const history = [searched('Albi', 1), searched('Pau', 3), searched('Foix', 2)]
    const rows = searchRows(history, [], '')
    expect(labels(rows)).toEqual(['Pau', 'Foix', 'Albi'])
    expect(rows.every((row) => row.fromHistory)).toBe(true)
  })

  it('shows nothing when there is neither history nor an answer', () => {
    expect(searchRows([], [], '')).toEqual([])
  })

  it('ranks the matching history above the geocoder answers', () => {
    const history = [searched('Bordeaux centre', 1)]
    const rows = searchRows(history, [place('Bordères'), place('Bordeaux Lac')], 'bord')
    expect(labels(rows)).toEqual(['Bordeaux centre', 'Bordères', 'Bordeaux Lac'])
    expect(rows.map((row) => row.fromHistory)).toEqual([true, false, false])
  })

  it('keeps out the history entries the query does not match', () => {
    const history = [searched('Albi', 2), searched('Pau', 1)]
    expect(labels(searchRows(history, [], 'pa'))).toEqual(['Pau'])
  })

  it('matches a query typed without accents', () => {
    expect(labels(searchRows([searched('Nîmes', 1)], [], 'nimes'))).toEqual(['Nîmes'])
  })

  it('shows a place the geocoder repeats only once, as a remembered one', () => {
    const rows = searchRows([searched('Pau', 1)], [place('Pau'), place('Pauillac')], 'pau')
    expect(labels(rows)).toEqual(['Pau', 'Pauillac'])
    expect(rows[0].fromHistory).toBe(true)
  })

  it('leaves the geocoder answers alone when nothing is remembered', () => {
    const rows = searchRows([], [place('Bayonne'), place('Rue de Bayonne', 'street')], 'bayonne')
    expect(labels(rows)).toEqual(['Bayonne', 'Rue de Bayonne'])
    expect(rows.some((row) => row.fromHistory)).toBe(false)
  })

  it('leaves the stored history untouched while ordering it', () => {
    const history = [searched('Albi', 1), searched('Pau', 3)]
    searchRows(history, [], '')
    expect(history.map((p) => p.label)).toEqual(['Albi', 'Pau'])
  })
})
