// The accent presets live in styles.css as per-theme overrides of a handful
// of solid tokens; every alpha token derives from `--c-accent-rgb`. Nothing
// type-checks a stylesheet, so these guards hold the contract the picker
// relies on: each preset is complete in BOTH themes, its triplet agrees with
// its hex, and it clears the same contrast floors as the brand green.
import { describe, expect, it } from 'vitest'
import CSS from './styles.css?raw'
import { ACCENTS, DEFAULT_ACCENT, isAccent } from './lib/colorScheme'

/** Every declaration of every block whose selector is exactly `selector`, merged in order */
function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, sel, body] of CSS.matchAll(/([^{}/]+?)\s*\{([^{}]*)\}/g)) {
    if (sel.trim() !== selector) continue
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim()
  }
  return out
}

const DARK = tokens(':root')
const LIGHT = { ...DARK, ...tokens(":root[data-theme='light']") }

/** The resolved palette for a preset in a theme — base, then the preset's overrides */
function palette(theme: 'dark' | 'light', accent: string): Record<string, string> {
  const base = theme === 'dark' ? DARK : LIGHT
  if (accent === DEFAULT_ACCENT) return base
  const sel =
    theme === 'dark'
      ? `:root:not([data-theme='light'])[data-accent='${accent}']`
      : `:root[data-theme='light'][data-accent='${accent}']`
  return { ...base, ...tokens(sel) }
}

type RGB = [number, number, number]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const luminance = (c: RGB) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `rgba(var(--c-accent-rgb), α)` composited over an opaque surface */
const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
  fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as RGB
const alphaOf = (value: string) => Number(/,\s*([\d.]+)\)$/.exec(value)?.[1])

/** The solid tones a preset must override — everything else derives from the triplet */
const SOLID = [
  '--c-accent',
  '--c-accent-rgb',
  '--c-accent-hover',
  '--c-on-accent',
  '--c-accent-pale',
  '--c-accent-deep',
]

describe('accent presets', () => {
  it('lead with the brand green, which is also the fallback', () => {
    expect(ACCENTS[0]).toBe(DEFAULT_ACCENT)
    expect(isAccent('blue')).toBe(true)
    expect(isAccent('pink')).toBe(false)
    expect(isAccent(undefined)).toBe(false)
  })

  it('derive every accent alpha from the triplet, so a preset never leaves a green tint behind', () => {
    for (const block of [DARK, LIGHT]) {
      for (const [name, value] of Object.entries(block)) {
        if (!/^--c-(accent|glow-top)/.test(name) || !value.startsWith('rgba(')) continue
        expect(value, name).toMatch(/^rgba\(var\(--c-accent-rgb\), [\d.]+\)$/)
      }
    }
  })

  for (const accent of ACCENTS) {
    for (const theme of ['dark', 'light'] as const) {
      describe(`${accent} · ${theme}`, () => {
        const p = palette(theme, accent)

        it('defines every solid tone, and a triplet that matches its hex', () => {
          if (accent !== DEFAULT_ACCENT) {
            const own =
              theme === 'dark'
                ? tokens(`:root:not([data-theme='light'])[data-accent='${accent}']`)
                : tokens(`:root[data-theme='light'][data-accent='${accent}']`)
            for (const name of SOLID) expect(own, name).toHaveProperty(name)
          }
          expect(p['--c-accent-rgb']).toBe(hex(p['--c-accent']).join(', '))
        })

        if (theme === 'light' && accent !== DEFAULT_ACCENT) {
          it('re-tints every green-leaning neutral of the paper without moving its lightness', () => {
            const own = tokens(`:root[data-theme='light'][data-accent='${accent}']`)
            // The base light block's neutrals are the ones the preset must carry
            const neutrals = Object.keys(own).filter((k) => !SOLID.includes(k))
            for (const name of ['--c-bg', '--c-surface-2', '--c-ink', '--c-border-09', '--c-glass-bg']) {
              expect(neutrals, name).toContain(name)
            }
            for (const name of neutrals) {
              const before = /#([0-9a-f]{6})/.exec(LIGHT[name])
              const after = /#([0-9a-f]{6})/.exec(own[name])
              if (!before || !after) continue
              // A hue swap only: luminance — and with it every contrast pair — holds
              expect(
                Math.abs(luminance(hex(before[0])) - luminance(hex(after[0]))),
                name,
              ).toBeLessThan(0.02)
            }
          })
        }

        // The light text ramp is the one the re-tint touches (the dark greys
        // are shared, and the dark `--c-faint` is a placeholder tone by design)
        it('keeps the text tones readable on the page', () => {
          const ramp = theme === 'light' ? ['--c-ink', '--c-body', '--c-mut', '--c-faint'] : ['--c-ink', '--c-body', '--c-mut']
          for (const text of ramp) {
            for (const surface of ['--c-bg', '--c-surface']) {
              expect(contrast(hex(p[text]), hex(p[surface])), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
            }
          }
        })

        it('has a swatch in the picker equal to its own accent', () => {
          expect(p[`--c-swatch-${accent}`]).toBe(p['--c-accent'])
        })

        it('keeps accent text and the on-accent label at WCAG AA', () => {
          const accentRgb = hex(p['--c-accent'])
          for (const surface of ['--c-bg', '--c-surface', '--c-card']) {
            expect(contrast(accentRgb, hex(p[surface])), surface).toBeGreaterThanOrEqual(4.5)
          }
          expect(contrast(hex(p['--c-on-accent']), accentRgb)).toBeGreaterThanOrEqual(4.5)
          // The selected chip / best-deal row: accent text on its own soft tint
          const tint = over(accentRgb, alphaOf(p['--c-accent-soft']), hex(p['--c-surface']))
          expect(contrast(accentRgb, tint)).toBeGreaterThanOrEqual(4.5)
        })
      })
    }
  }
})
