import { describe, expect, it } from 'vitest'
import { agoLabel, distLabel, durationLabel, fmtPrice, plural } from './format'

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

describe('distLabel', () => {
  it('uses metres under 1 km, tenths of km above', () => {
    expect(distLabel(0.85)).toBe('850 m')
    expect(distLabel(2.34)).toBe('2,3 km')
  })
})

describe('durationLabel', () => {
  it('uses minutes under an hour, h mm above', () => {
    expect(durationLabel(45)).toBe('45 min')
    expect(durationLabel(316)).toBe('5 h 16')
    expect(durationLabel(60)).toBe('1 h 00')
  })
})

describe('agoLabel', () => {
  const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

  it('scales from minutes to days', () => {
    expect(agoLabel(ago(0))).toBe("à l'instant")
    expect(agoLabel(ago(5))).toBe('il y a 5 min')
    expect(agoLabel(ago(120))).toBe('il y a 2 h')
    expect(agoLabel(ago(26 * 60))).toBe('hier')
    expect(agoLabel(ago(3 * 24 * 60))).toBe('il y a 3 j')
  })

  it('degrades to an em-dash on missing or invalid input', () => {
    expect(agoLabel(undefined)).toBe('—')
    expect(agoLabel('not-a-date')).toBe('—')
  })
})

describe('plural', () => {
  it('appends an s from 2, supports irregular plurals', () => {
    expect(plural(1, 'station')).toBe('1 station')
    expect(plural(3, 'station')).toBe('3 stations')
    expect(plural(2, 'cheval', 'chevaux')).toBe('2 chevaux')
  })
})
