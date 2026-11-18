import { describe, expect, it } from 'vitest'
import { DARK_OVERRIDES, restyle } from './basemapTone'

describe('restyle', () => {
  it('merges paint, layout and zoom range over the layers it names, drops what it unsets, and leaves the others alone', () => {
    const input = {
      layers: [
        { id: 'road', paint: { 'line-color': '#000', 'line-width': 2, 'line-pattern': 'dots' } },
        { id: 'city', maxzoom: 12, layout: { 'text-size': 10, 'text-font': ['Noto Sans Regular'] } },
        { id: 'label', paint: { 'text-color': '#666' } },
      ],
    }
    const out = restyle(input, {
      road: { paint: { 'line-color': '#333', 'line-pattern': undefined } },
      city: { layout: { 'text-size': 14 }, maxzoom: 14 },
      gone: { paint: { 'fill-color': '#fff' } },
    })
    expect(out.layers).toEqual([
      { id: 'road', paint: { 'line-color': '#333', 'line-width': 2 } },
      { id: 'city', maxzoom: 14, layout: { 'text-size': 14, 'text-font': ['Noto Sans Regular'] } },
      { id: 'label', paint: { 'text-color': '#666' } },
    ])
    expect(input.layers[0].paint?.['line-color']).toBe('#000')
  })
})

describe('DARK_OVERRIDES', () => {
  it('writes its zoom stops on Leaflet zoom, one level above the map MapLibre draws', () => {
    // CARTO's minor streets are 0.5 px at z12 and 2 px at z14: MapLibre is at
    // z11 and z13 when Leaflet shows those
    const width = DARK_OVERRIDES.highway_minor.paint?.['line-width'] as unknown[]
    expect(width.slice(0, 7)).toEqual(['interpolate', ['linear'], ['zoom'], 11, 0.5, 13, 2])
  })
})
