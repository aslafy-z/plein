// Catalog parity: every locale translates exactly the keys of the source
// locale, with the same parameters. Paraglide falls back to the base locale
// for a missing key, so a gap never fails the build — it ships French to a
// reader of another language. Reads the JSON catalogs themselves rather than
// the compiled functions, which have already papered over the gap.
import { describe, expect, it } from 'vitest'
import SETTINGS_SOURCE from '../project.inlang/settings.json?raw'

type Variant = { declarations?: string[]; match?: Record<string, string> }
type Message = string | Variant[]
type Catalog = Record<string, Message>

const CATALOG_SOURCES = import.meta.glob<string>('../messages/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const settings = JSON.parse(SETTINGS_SOURCE) as { baseLocale: string; locales: string[] }

const catalog = (locale: string): Catalog => {
  const raw = CATALOG_SOURCES[`../messages/${locale}.json`]
  if (raw === undefined) throw new Error(`messages/${locale}.json is missing`)
  const { $schema: _schema, ...messages } = JSON.parse(raw) as Catalog
  return messages
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1].trim())

/** The names a caller has to pass: `{name}` in a plain message, `input name` in a variant one. */
const inputsOf = (message: Message): string[] => {
  if (typeof message === 'string') return [...new Set(placeholders(message))].sort()
  const names = message.flatMap((variant) =>
    (variant.declarations ?? [])
      .filter((declaration) => declaration.startsWith('input '))
      .map((declaration) => declaration.slice('input '.length).trim()),
  )
  return [...new Set(names)].sort()
}

/** Placeholders a variant message uses without declaring them as an input or a local. */
const undeclaredOf = (message: Message): string[] => {
  if (typeof message === 'string') return []
  return message.flatMap((variant) => {
    const declared = new Set(
      (variant.declarations ?? []).map((declaration) => declaration.split(/\s+/)[1]),
    )
    return Object.values(variant.match ?? {})
      .flatMap(placeholders)
      .filter((name) => !declared.has(name))
  })
}

const source = catalog(settings.baseLocale)
const sourceKeys = Object.keys(source).sort()
const translations = settings.locales.filter((locale) => locale !== settings.baseLocale)

describe('message catalogs', () => {
  it('lists the source locale and at least one translation', () => {
    expect(settings.locales).toContain(settings.baseLocale)
    expect(translations.length).toBeGreaterThan(0)
    expect(sourceKeys.length).toBeGreaterThan(0)
  })

  it.each(translations)('%s has exactly the keys of the source locale', (locale) => {
    const keys = new Set(Object.keys(catalog(locale)))
    const sourceSet = new Set(sourceKeys)
    expect({
      missing: sourceKeys.filter((key) => !keys.has(key)),
      orphan: [...keys].filter((key) => !sourceSet.has(key)).sort(),
    }).toEqual({ missing: [], orphan: [] })
  })

  it.each(translations)('%s takes the same parameters as the source locale', (locale) => {
    const messages = catalog(locale)
    const mismatches = sourceKeys
      .filter((key) => key in messages)
      .filter((key) => inputsOf(messages[key]).join() !== inputsOf(source[key]).join())
      .map((key) => ({ key, source: inputsOf(source[key]), [locale]: inputsOf(messages[key]) }))
    expect(mismatches).toEqual([])
  })

  it.each(settings.locales)('%s only uses placeholders its variants declare', (locale) => {
    const undeclared = Object.entries(catalog(locale))
      .map(([key, message]) => ({ key, undeclared: undeclaredOf(message) }))
      .filter((entry) => entry.undeclared.length > 0)
    expect(undeclared).toEqual([])
  })
})
