import { describe, expect, it } from 'vitest'
import { USER_DOT_SIZE, userDotHtml } from './userDot'

// One dot markup for both maps — the builder is what keeps the zone map's
// « you are here » and the route map's from drifting apart.

describe('userDotHtml', () => {
  it('draws the accent dot inside a soft accent halo', () => {
    const html = userDotHtml()
    expect(html).toContain('background:var(--c-accent-soft-15)')
    expect(html).toContain('background:var(--c-accent)')
    expect(html).toContain('border:3px solid var(--c-accent-deep)')
  })

  it('sizes the halo on the constant the callers anchor on', () => {
    expect(userDotHtml()).toContain(`width:${USER_DOT_SIZE}px;height:${USER_DOT_SIZE}px`)
  })
})
