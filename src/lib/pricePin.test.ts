import { describe, expect, it } from 'vitest'
import { pricePinDotHtml, pricePinHtml } from './pricePin'

// One pin markup for both maps — the builder is what keeps the zone map's
// pins and the route map's corridor stops from drifting apart again.

describe('pricePinHtml', () => {
  it('prints the label it is handed, formatted upstream', () => {
    expect(pricePinHtml('1,70')).toContain('>1,70</div>')
  })

  it('keeps a plain pin on the base surface with the base type', () => {
    const html = pricePinHtml('1,70')
    expect(html).toContain('background:var(--c-surface-3)')
    expect(html).toContain('color:var(--c-body)')
    expect(html).toContain("600 13px 'Spline Sans Mono'")
    expect(html).toContain('class="pin-bubble"')
  })

  it('turns a deal green, bubble and tip together', () => {
    const html = pricePinHtml('1,70', { tier: 'deal' })
    expect(html).toContain('background:var(--c-accent)')
    expect(html).toContain('color:var(--c-on-accent)')
    expect(html).toContain('class="pin-bubble pin-bubble--deal"')
    expect(html).toContain('border-top:7px solid var(--c-accent)')
  })

  it('tints an expensive pin without changing its surface', () => {
    const html = pricePinHtml('1,95', { tier: 'high' })
    expect(html).toContain('background:var(--c-surface-3)')
    expect(html).toContain('color:var(--c-warn)')
    expect(html).toContain('class="pin-bubble pin-bubble--high"')
  })

  it('crowns the recommended pin: deal green + big type, whatever its tier', () => {
    const html = pricePinHtml('1,80', { tier: 'mid', recommended: true })
    expect(html).toContain('background:var(--c-accent)')
    expect(html).toContain("700 15px 'Spline Sans Mono'")
    expect(html).toContain('drop-shadow(0 4px 12px')
  })

  it('rings the focused pin and gives it the strong glow', () => {
    const html = pricePinHtml('1,80', { focused: true })
    expect(html).toContain('border:2px solid var(--c-accent)')
    expect(html).toContain('drop-shadow(0 6px 16px')
    const focusedDeal = pricePinHtml('1,80', { tier: 'deal', focused: true })
    expect(focusedDeal).toContain('border:2px solid var(--c-accent-pale)')
  })
})

describe('pricePinDotHtml', () => {
  it('names the tier as a class, nothing else', () => {
    expect(pricePinDotHtml()).toContain('class="pin-dot"')
    expect(pricePinDotHtml('deal')).toContain('class="pin-dot pin-dot--deal"')
    expect(pricePinDotHtml('high')).toContain('class="pin-dot pin-dot--high"')
  })
})
