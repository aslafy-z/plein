import { describe, expect, it } from 'vitest'
import { PLACE_PIN_ANCHOR, PLACE_PIN_BOX, placePinHtml } from './placePin'

describe('placePinHtml', () => {
  it('draws a neutral ink teardrop that re-tints with the theme', () => {
    const html = placePinHtml()
    expect(html).toContain('fill:var(--c-ink)')
    expect(html).toContain('stroke:var(--c-bg)')
    // Never the accent or the warn tone: those belong to the user dot and
    // the price tiers
    expect(html).not.toContain('--c-accent')
    expect(html).not.toContain('--c-warn')
  })

  it('fills the touch box the caller anchors by its bottom center', () => {
    expect(placePinHtml()).toContain(`width:${PLACE_PIN_BOX}px;height:${PLACE_PIN_BOX}px`)
    expect(PLACE_PIN_ANCHOR).toEqual([PLACE_PIN_BOX / 2, PLACE_PIN_BOX])
    expect(PLACE_PIN_BOX).toBeGreaterThanOrEqual(44)
  })
})
