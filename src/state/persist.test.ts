import { afterEach, describe, expect, it, vi } from 'vitest'
import { foldRecentsIntoSearchHistory, loadPersisted } from './persist'
import type { SearchedPlace } from './persist'

// The route's own « Recent » store is gone — a blob written by an older build
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

// Country codes used to be ISO 3166-1 alpha-3 — a blob written by that
// generation carries a 3-letter source choice and 3-letter geocoder country
// tags on history entries, and both are persisted user state that must
// survive the rename.
describe('loadPersisted country-code migration', () => {
  const stubBlob = (blob: unknown) =>
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify(blob),
      setItem: () => {},
      removeItem: () => {},
    })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps a 3-letter source choice onto the 2-letter scheme', () => {
    stubBlob({ sourceId: 'fra' })
    expect(loadPersisted().sourceId).toBe('fr')
    stubBlob({ sourceId: 'and' })
    expect(loadPersisted().sourceId).toBe('ad')
  })

  it('leaves current and unknown source ids to the store validation', () => {
    stubBlob({ sourceId: 'es' })
    expect(loadPersisted().sourceId).toBe('es')
    stubBlob({ sourceId: 'gouv' })
    expect(loadPersisted().sourceId).toBe('gouv')
  })

  it('maps 3-letter geocoder countries in the search history', () => {
    stubBlob({
      searchHistory: [
        { ...searched('Encamp', 5), country: 'and' },
        { ...searched('Coimbra', 4), country: 'prt' },
        searched('Annecy', 3),
      ],
    })
    const history = loadPersisted().searchHistory ?? []
    expect(history.map((p) => p.country)).toEqual(['ad', 'pt', undefined])
  })
})

// `lastPos` used to stand for both « where the map was looking » and « where
// the user is ». Splitting the fix off into `lastFix` decides, for every blob
// already on a device, whether the app may draw a user dot on it.
describe('loadPersisted position migration', () => {
  const stubBlob = (blob: unknown) =>
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify(blob),
      setItem: () => {},
      removeItem: () => {},
    })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const toulouse = { lat: 43.6047, lng: 1.4442 }

  it('takes a granted blob’s last position as its fix', () => {
    stubBlob({ geoGranted: true, lastPos: toulouse })
    expect(loadPersisted().lastFix).toEqual(toulouse)
  })

  it('invents no fix for a blob that never located the user', () => {
    stubBlob({ lastPos: toulouse })
    expect(loadPersisted().lastFix).toBeUndefined()
    stubBlob({ geoGranted: false, lastPos: toulouse })
    expect(loadPersisted().lastFix).toBeUndefined()
  })

  it('leaves a real fix alone when the map was searched elsewhere', () => {
    const paris = { lat: 48.8566, lng: 2.3522 }
    stubBlob({ geoGranted: true, lastPos: paris, lastFix: toulouse })
    expect(loadPersisted().lastFix).toEqual(toulouse)
    expect(loadPersisted().lastPos).toEqual(paris)
  })
})

// The blob feeds `useState` initialisers directly: a field of the wrong shape
// is a crash on every boot, not a wrong setting. Each one is dropped on the
// way in, so the store falls back to its first-visit default, and the fields
// next to it survive.
describe('loadPersisted shape validation', () => {
  const stubBlob = (blob: unknown) =>
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify(blob),
      setItem: () => {},
      removeItem: () => {},
    })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const toulouse = { lat: 43.6047, lng: 1.4442 }
  const favorite = { id: 'fr-31000009', name: 'Station U', init: 'SU', lat: 43.61, lng: 1.45 }

  it('answers an empty blob when the stored value is not an object', () => {
    for (const blob of [null, 5, 'junk', [1, 2]]) {
      stubBlob(blob)
      expect(loadPersisted()).toEqual({})
    }
  })

  it('drops lists that are not lists', () => {
    stubBlob({ brandSel: 'Total', favorites: {}, searchHistory: 'Annecy', serviceTags: 7, fuel: 'e10' })
    expect(loadPersisted()).toEqual({ fuel: 'e10' })
  })

  it('drops the entries of a list that are not what it holds', () => {
    stubBlob({
      brandSel: ['Total', 5, null, '', 'Leclerc'],
      favorites: [
        favorite,
        'fr-1',
        null,
        { ...favorite, id: 12 },
        { ...favorite, name: undefined },
        { ...favorite, lat: 'north' },
        { ...favorite, lng: 400 },
      ],
      searchHistory: [
        searched('Annecy', 3),
        'Bordeaux',
        null,
        { ...searched('No point', 2), point: undefined },
        { ...searched('Off the globe', 2), point: { lat: 91, lng: 0 } },
        { ...searched('', 2) },
      ],
    })
    const out = loadPersisted()
    expect(out.brandSel).toEqual(['Total', 'Leclerc'])
    expect(out.favorites).toEqual([favorite])
    expect(out.searchHistory).toEqual([searched('Annecy', 3)])
  })

  it('repairs the secondary fields of an entry rather than losing the place', () => {
    stubBlob({
      favorites: [{ ...favorite, city: 42 }],
      searchHistory: [
        { label: 'Annecy', point: toulouse, kind: 'planet', at: 'yesterday', country: 'fr' },
      ],
    })
    const out = loadPersisted()
    expect(out.favorites).toEqual([favorite])
    expect(out.searchHistory).toEqual([
      { label: 'Annecy', sublabel: '', point: toulouse, kind: 'other', at: 0 },
    ])
  })

  it('range-checks the trips folded in from the retired recents', () => {
    stubBlob({
      searchHistory: {},
      recents: [
        { label: 'Montpellier', point: { lat: 43.61, lng: 3.88 } },
        { label: 'Nowhere', point: { lat: 943, lng: 3.88 } },
      ],
    })
    expect(loadPersisted().searchHistory?.map((p) => p.label)).toEqual(['Montpellier'])
  })

  it('drops numbers that are not finite or that no slider can set', () => {
    stubBlob({ radius: 0, tank: 500, consumption: 0, startTankPct: -5, arrivalTankPct: 85 })
    expect(loadPersisted()).toEqual({})
    // JSON has no NaN/Infinity: they come back as null, strings stay strings
    stubBlob({ radius: null, tank: '50', consumption: [6.5], startTankPct: {} })
    expect(loadPersisted()).toEqual({})
  })

  it('keeps numbers on the bounds the sliders stop at', () => {
    const low = { radius: 1, tank: 5, consumption: 3, startTankPct: 10, arrivalTankPct: 0 }
    stubBlob(low)
    expect(loadPersisted()).toEqual(low)
    const high = { radius: 25, tank: 80, consumption: 12, startTankPct: 100, arrivalTankPct: 80 }
    stubBlob(high)
    expect(loadPersisted()).toEqual(high)
  })

  it('still takes the legacy consumption key, held to the same bounds', () => {
    stubBlob({ conso: 7.5 })
    expect(loadPersisted()).toEqual({ consumption: 7.5 })
    stubBlob({ conso: 0 })
    expect(loadPersisted()).toEqual({})
  })

  it('drops points that are not a latitude and a longitude', () => {
    for (const point of ['here', [43.6, 1.44], { lat: 43.6 }, { lat: '43.6', lng: 1.44 }, { lat: 43.6, lng: 181 }, { lat: -91, lng: 0 }]) {
      stubBlob({ lastPos: point, lastFix: point })
      expect(loadPersisted()).toEqual({})
    }
    stubBlob({ lastPos: toulouse, lastFix: toulouse })
    expect(loadPersisted()).toEqual({ lastPos: toulouse, lastFix: toulouse })
  })

  it('derives no fix from a malformed last position', () => {
    stubBlob({ geoGranted: true, lastPos: { lat: 'x', lng: 1 } })
    expect(loadPersisted()).toEqual({ geoGranted: true })
  })

  it('drops flags that are not booleans', () => {
    stubBlob({
      avoidMotorway: 'yes',
      avoidToll: 1,
      onboarded: 'true',
      geoGranted: null,
      installDismissed: {},
      sheetHint: 0,
    })
    expect(loadPersisted()).toEqual({})
    const flags = {
      avoidMotorway: true,
      avoidToll: false,
      onboarded: true,
      geoGranted: false,
      installDismissed: true,
      sheetHint: false,
    }
    stubBlob(flags)
    expect(loadPersisted()).toEqual(flags)
  })

  it('drops enum values this build does not know', () => {
    stubBlob({ mapsSite: 'bing', fuel: 'kerosene', vehicle: 'truck' })
    expect(loadPersisted()).toEqual({})
    stubBlob({ mapsSite: 'waze', fuel: 'lpg', vehicle: 'motorcycle' })
    expect(loadPersisted()).toEqual({ mapsSite: 'waze', fuel: 'lpg', vehicle: 'motorcycle' })
  })

  it('hands the choices validated where they are read only as strings', () => {
    stubBlob({ locale: 5, theme: ['dark'], accent: {}, sourceId: 3 })
    expect(loadPersisted()).toEqual({})
    const choices = { locale: 'pt', theme: 'light', accent: 'violet', sourceId: 'es' }
    stubBlob(choices)
    expect(loadPersisted()).toEqual(choices)
  })
})
