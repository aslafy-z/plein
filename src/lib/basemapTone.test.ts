import { describe, expect, it } from 'vitest'
import { repaint } from './basemapTone'

describe('repaint', () => {
  it('merges paint over the layers it names and leaves the others alone', () => {
    const input = {
      layers: [
        { id: 'road', paint: { 'line-color': '#000', 'line-width': 2 } },
        { id: 'label', paint: { 'text-color': '#666' } },
      ],
    }
    const out = repaint(input, { road: { 'line-color': '#333' }, gone: { 'fill-color': '#fff' } })
    expect(out.layers).toEqual([
      { id: 'road', paint: { 'line-color': '#333', 'line-width': 2 } },
      { id: 'label', paint: { 'text-color': '#666' } },
    ])
    expect(input.layers[0].paint['line-color']).toBe('#000')
  })
})
