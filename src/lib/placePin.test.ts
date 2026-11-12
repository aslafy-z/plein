import { describe, expect, it } from 'vitest'
import { USER_DOT_SIZE } from './userDot'
import { PLACE_PIN_ANCHOR, PLACE_PIN_BOX, placePinHtml } from './placePin'

describe('placePinHtml', () => {
  it("draws the user dot's shape in neutral ink", () => {
    const html = placePinHtml()
    expect(html).toContain('background:var(--c-ink)')
    expect(html).toContain('border:3px solid var(--c-bg)')
    expect(html).toContain(`width:${USER_DOT_SIZE}px;height:${USER_DOT_SIZE}px;border-radius:50%`)
    // Never the accent or the warn tone: those belong to the user dot and
    // the price tiers
    expect(html).not.toContain('--c-accent')
    expect(html).not.toContain('--c-warn')
  })

  it('fills the touch box the caller anchors by its center', () => {
    expect(placePinHtml()).toContain(`width:${PLACE_PIN_BOX}px;height:${PLACE_PIN_BOX}px`)
    expect(PLACE_PIN_ANCHOR).toEqual([PLACE_PIN_BOX / 2, PLACE_PIN_BOX / 2])
    expect(PLACE_PIN_BOX).toBeGreaterThanOrEqual(44)
  })
})
