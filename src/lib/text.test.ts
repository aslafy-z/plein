import { describe, expect, it } from 'vitest'
import { escapeHtml, initialsOf, pinInitialsHtml, titleCase } from './text'

describe('escapeHtml', () => {
  it('neutralizes the characters that open markup or close an attribute', () => {
    expect(escapeHtml('<b')).toBe('&lt;b')
    expect(escapeHtml('<img src=x onerror="a(1)">')).toBe(
      '&lt;img src=x onerror=&quot;a(1)&quot;&gt;',
    )
    expect(escapeHtml("L'&")).toBe('L&#39;&amp;')
  })

  it('escapes an ampersand once, entities included', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('SU')).toBe('SU')
    expect(escapeHtml('É2')).toBe('É2')
    expect(escapeHtml('')).toBe('')
  })
})

describe('pinInitialsHtml', () => {
  it('passes provider initials through', () => {
    expect(pinInitialsHtml('SU')).toBe('SU')
    expect(pinInitialsHtml('A')).toBe('A')
  })

  it('escapes initials that would open a tag', () => {
    expect(pinInitialsHtml('<B')).toBe('&lt;B')
    expect(pinInitialsHtml('&"')).toBe('&amp;&quot;')
  })

  it('clamps to two characters before escaping', () => {
    expect(pinInitialsHtml('<script>alert(1)</script>')).toBe('&lt;s')
    expect(pinInitialsHtml('TOTAL')).toBe('TO')
  })

  it('never halves a surrogate pair', () => {
    expect(pinInitialsHtml('A😀B')).toBe('A😀')
  })

  it('prints nothing for a missing value', () => {
    expect(pinInitialsHtml(undefined)).toBe('')
  })
})

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
