// The web fonts are vendored (public/fonts/) instead of pulled from Google's
// CDN: the offline shell has to keep its typography — the mono face carries
// every price, so losing it reflows the number columns — and no cold load
// should hand a visitor's IP to a third party. Both properties are one stray
// <link> away from silently regressing, hence these guards.
import { describe, expect, it } from 'vitest'
import HTML from '../index.html?raw'
import CSS from './styles.css?raw'
import HEADERS from '../public/_headers?raw'
import SW from '../public/sw.js?raw'

// Lazy glob: the keys tell us which files ship, without pulling the woff2 in
const SHIPPED = new Set(
  Object.keys(import.meta.glob('../public/fonts/*.woff2')).map((p) =>
    p.replace('../public', ''),
  ),
)

/** Every `url(/fonts/…)` the stylesheet points at. */
const fontUrls = [...CSS.matchAll(/url\('(\/fonts\/[^']+)'\)/g)].map((m) => m[1])

describe('web fonts', () => {
  it('reaches no font CDN from the shell or the styles', () => {
    for (const [name, source] of [
      ['index.html', HTML],
      ['styles.css', CSS],
    ] as const) {
      expect(source, `${name} must not reference a font CDN`).not.toMatch(
        /fonts\.(googleapis|gstatic)\.com/,
      )
    }
  })

  it('declares both families locally, latin and latin-ext', () => {
    for (const family of ['Archivo', 'Spline Sans Mono']) {
      const faces = [...CSS.matchAll(/@font-face \{[^}]*\}/g)]
        .map((m) => m[0])
        .filter((face) => face.includes(`font-family: '${family}'`))
      expect(faces, `${family} needs a latin and a latin-ext face`).toHaveLength(2)
      for (const face of faces) {
        expect(face).toMatch(/src: url\('\/fonts\/[^']+\.woff2'\) format\('woff2'\)/)
        // Variable fonts: one file per subset spans the whole weight range, so
        // pinning a single weight here would make every other one synthetic.
        expect(face).toMatch(/font-weight: \d+ \d+;/)
        expect(face).toMatch(/font-display: swap;/)
        // Without it, both subsets download on every load
        expect(face).toMatch(/unicode-range:/)
      }
    }
  })

  it('ships every file the stylesheet asks for', () => {
    expect(fontUrls).toHaveLength(4)
    for (const url of fontUrls) {
      expect(SHIPPED, `${url} must exist in public/fonts/`).toContain(url)
    }
  })

  it('preloads the latin faces, and only those', () => {
    const preloads = [...HTML.matchAll(/<link\b[^>]*rel="preload"[^>]*>/gs)].map((m) => m[0])
    expect(preloads).toHaveLength(2)
    for (const link of preloads) {
      const href = /href="([^"]+)"/.exec(link)?.[1]
      expect(fontUrls).toContain(href)
      expect(href).not.toContain('latin-ext') // gated by unicode-range: preloading it wastes bytes
      // Fonts are fetched in CORS mode: without crossorigin the preload is
      // discarded and the file downloads a second time.
      expect(link).toMatch(/\bcrossorigin\b/)
      expect(link).toMatch(/as="font"/)
    }
  })

  it('keeps the fonts cacheable offline and immutable on the edge', () => {
    expect(SW).toContain("url.pathname.startsWith('/fonts/')")
    expect(HEADERS).toMatch(/^\/fonts\/\*\n\s+Cache-Control: [^\n]*immutable/m)
  })
})
