import { describe, expect, it } from 'vitest'
import {
  agoLabel,
  clockLabel,
  distLabel,
  durationLabel,
  fmtDecimal,
  fmtPrice,
  minutesLabel,
  sizeLabel,
} from './format'

// No locale is set, so every assertion below reads the base locale (French).
// A second locale would need `setLocale` around the call — these tests exist to
// pin the conventions, not to enumerate the catalog.

describe('fmtPrice', () => {
  it('formats to two decimals with a French comma', () => {
    expect(fmtPrice(1.679)).toBe('1,68')
    expect(fmtPrice(0.84)).toBe('0,84')
    expect(fmtPrice(10.5)).toBe('10,50')
  })

  it('degrades to an em-dash on missing values', () => {
    expect(fmtPrice(null)).toBe('—')
    expect(fmtPrice(undefined)).toBe('—')
    expect(fmtPrice(Infinity)).toBe('—')
  })
})

describe('fmtDecimal', () => {
  it('keeps the requested precision in the locale separator', () => {
    expect(fmtDecimal(6.5, 1)).toBe('6,5')
    expect(fmtDecimal(5, 1)).toBe('5,0')
  })
})

describe('distLabel', () => {
  it('uses metres under 1 km, tenths of km above', () => {
    expect(distLabel(0.85)).toBe('850 m')
    expect(distLabel(2.34)).toBe('2,3 km')
  })
})

describe('sizeLabel', () => {
  it('says « almost nothing » instead of rounding down to zero', () => {
    // « 0 ko » next to a cache the app says it is keeping reads as a bug
    expect(sizeLabel(0)).toBe('moins de 1 ko')
    expect(sizeLabel(400)).toBe('moins de 1 ko')
    expect(sizeLabel(1023)).toBe('moins de 1 ko')
  })

  // `Intl` separates a value from its unit with a narrow no-break space
  // (U+202F), which is not the space the catalog strings above use
  it('counts in whole kilo-octets, then in tenths of mega-octets', () => {
    expect(sizeLabel(1024)).toBe('1\u202fko')
    expect(sizeLabel(18 * 1024)).toBe('18\u202fko')
    expect(sizeLabel(1024 * 1024)).toBe('1\u202fMo')
    expect(sizeLabel(2.4 * 1024 * 1024)).toBe('2,4\u202fMo')
  })
})

describe('durationLabel', () => {
  it('uses minutes under an hour, h mm above', () => {
    expect(durationLabel(45)).toBe('45 min')
    expect(durationLabel(316)).toBe('5 h 16')
    expect(durationLabel(60)).toBe('1 h 00')
  })
})

describe('minutesLabel', () => {
  it('reads minutes-from-midnight as a wall clock, wrapping past a day', () => {
    expect(minutesLabel(21 * 60 + 30)).toBe('21 h 30')
    expect(minutesLabel(8 * 60)).toBe('8 h')
    expect(minutesLabel(30 * 60)).toBe('6 h')
  })
})

describe('clockLabel', () => {
  it('reads the local wall clock in the locale own convention', () => {
    expect(clockLabel(new Date(2026, 6, 25, 17, 36))).toBe('17:36')
    expect(clockLabel(new Date(2026, 6, 25, 9, 5))).toBe('9:05')
  })
})

describe('agoLabel', () => {
  const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
  // Intl separates the count from its unit with a no-break space in French —
  // correct typography, and invisible in a diff, hence the explicit escape.
  const NB = '\u00A0'

  it('scales from minutes to days', () => {
    expect(agoLabel(ago(0))).toBe("à l'instant")
    expect(agoLabel(ago(5))).toBe(`il y a 5${NB}min`)
    expect(agoLabel(ago(120))).toBe(`il y a 2${NB}h`)
    expect(agoLabel(ago(26 * 60))).toBe('hier')
    expect(agoLabel(ago(3 * 24 * 60))).toBe(`il y a 3${NB}j`)
  })

  it('degrades to an em-dash on missing or invalid input', () => {
    expect(agoLabel(undefined)).toBe('—')
    expect(agoLabel('not-a-date')).toBe('—')
  })
})
