import { describe, expect, it } from 'vitest'
import { isFicheSwap, type NavHistoryState } from './store'

// Which nav changes swap the current history entry instead of stacking one.
// Everything else about the history effect needs a browser (routing.spec.ts,
// desktop.spec.ts); this is the decision it is built on.

const entry = (over: Partial<NavHistoryState> = {}): NavHistoryState => ({
  plein: true,
  screen: 'detail',
  detailId: 'su',
  filtersOpen: false,
  idx: 1,
  ...over,
})

describe('isFicheSwap', () => {
  it('swaps when one fiche replaces another', () => {
    expect(isFicheSwap(entry(), { screen: 'detail', detailId: 'in', filtersOpen: false })).toBe(true)
  })

  it('stacks when the fiche is opened from another screen', () => {
    expect(
      isFicheSwap(entry({ screen: 'map', detailId: null }), {
        screen: 'detail',
        detailId: 'su',
        filtersOpen: false,
      }),
    ).toBe(false)
  })

  it('stacks when the fiche is left for another screen', () => {
    expect(isFicheSwap(entry(), { screen: 'map', detailId: null, filtersOpen: false })).toBe(false)
  })

  it('is not a swap when the station does not change', () => {
    expect(isFicheSwap(entry(), { screen: 'detail', detailId: 'su', filtersOpen: false })).toBe(
      false,
    )
  })

  it('is not a swap when the filters sheet opens or closes with it', () => {
    expect(isFicheSwap(entry(), { screen: 'detail', detailId: 'in', filtersOpen: true })).toBe(false)
    expect(
      isFicheSwap(entry({ filtersOpen: true }), {
        screen: 'detail',
        detailId: 'in',
        filtersOpen: false,
      }),
    ).toBe(false)
  })

  it('never swaps an entry the app does not own', () => {
    const foreign = { screen: 'detail', detailId: 'in', filtersOpen: false } as const
    expect(isFicheSwap(null, foreign)).toBe(false)
    expect(isFicheSwap(entry({ plein: undefined }), foreign)).toBe(false)
  })
})
