import { describe, expect, it } from 'vitest'
import { openStatus, type StationHours } from './hours'

// 2026-07-15 is a Wednesday (ISO day 3); every check pins `now` explicitly.
const at = (h: number, min = 0) => new Date(2026, 6, 15, h, min)

const staffed = (open: number, close: number, days: number[] = [1, 2, 3, 4, 5, 6, 7]): StationHours => ({
  auto24: false,
  days: Object.fromEntries(days.map((d) => [d, { closed: false, ranges: [{ open, close }] }])),
})

describe('openStatus', () => {
  it('is unknown without data — never claims « Ouvert » without evidence', () => {
    expect(openStatus(undefined, at(12))).toBeNull()
    // A day listed as open but without time ranges counts as unknown too
    expect(openStatus({ auto24: false, days: { 3: { closed: false, ranges: [] } } }, at(12))).toBeNull()
    // …and so does a day the source says nothing about
    expect(openStatus(staffed(8 * 60, 19 * 60, [1, 2]), at(12))).toBeNull()
  })

  it('24/24 automats are always open', () => {
    const s = openStatus({ auto24: true, days: {} }, at(3))
    expect(s).toEqual({ open: true, label: 'Ouvert 24/24', short: 'ouvert 24/24' })
  })

  it('a staffed range opens and closes at the right minutes', () => {
    const hours = staffed(8 * 60, 21 * 60 + 30)
    expect(openStatus(hours, at(12))).toEqual({
      open: true,
      label: 'Ouvert · ferme à 21 h 30',
      short: 'ouvert',
    })
    expect(openStatus(hours, at(7, 59))).toEqual({
      open: false,
      label: 'Fermé · ouvre à 8 h',
      short: 'fermé',
    })
    // Past the last range of the day → plain « Fermé »
    expect(openStatus(hours, at(22))?.label).toBe('Fermé')
  })

  it('a closed day says so', () => {
    const hours: StationHours = {
      auto24: false,
      days: { 3: { closed: true, ranges: [] } },
    }
    expect(openStatus(hours, at(12))).toEqual({
      open: false,
      label: "Fermé aujourd'hui",
      short: 'fermé',
    })
  })

  it("an overnight range spills past midnight into the next day", () => {
    // Open 22 h – 6 h every day: at 2 h the station is open via YESTERDAY's range
    const hours = staffed(22 * 60, 6 * 60)
    expect(openStatus(hours, at(2))).toEqual({
      open: true,
      label: 'Ouvert · ferme à 6 h',
      short: 'ouvert',
    })
    expect(openStatus(hours, at(12))?.open).toBe(false)
  })
})
