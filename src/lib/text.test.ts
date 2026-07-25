import { describe, expect, it } from 'vitest'
import { initialsOf, titleCase } from './text'

describe('titleCase', () => {
  it('capitalizes every word of a shouted label', () => {
    expect(titleCase('ESTACION DE SERVICIO')).toBe('Estacion De Servicio')
    expect(titleCase('SAINT-JEAN')).toBe('Saint-Jean')
  })

  it('keeps the original separators, spacing included', () => {
    expect(titleCase("AVENUE  DE L'EUROPE")).toBe("Avenue  De L'Europe")
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two meaningful words', () => {
    expect(initialsOf('Super U')).toBe('SU')
    expect(initialsOf('TotalEnergies · Centre')).toBe('TC')
    expect(initialsOf('AS 24')).toBe('A2')
  })

  it('skips one-letter words, which carry no signal', () => {
    // Only "Station" survives the filter, so the two-word branch never fires
    expect(initialsOf('Station U')).toBe('ST')
  })

  it('falls back to the first two characters on a single word', () => {
    expect(initialsOf('Repsol')).toBe('RE')
    expect(initialsOf('a')).toBe('A')
  })
})
