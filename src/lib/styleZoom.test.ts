import { describe, expect, it } from 'vitest'
import { shiftStyleZoom } from './styleZoom'

const style = (layers: object[]) => ({ version: 8, sources: {}, layers }) as { layers: object[] }

describe('shiftStyleZoom', () => {
  it('moves layer zoom ranges, never below zero', () => {
    const out = shiftStyleZoom(
      style([
        { id: 'a', minzoom: 12, maxzoom: 15 },
        { id: 'b', minzoom: 0 },
        { id: 'c' },
      ]),
      -1,
    )
    expect(out.layers).toEqual([
      { id: 'a', minzoom: 11, maxzoom: 14 },
      { id: 'b', minzoom: 0 },
      { id: 'c' },
    ])
  })

  it('moves the stops of interpolate and step on zoom, and nothing else', () => {
    const [layer] = shiftStyleZoom(
      style([
        {
          id: 'road',
          paint: {
            'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 13, 0.5, 18, 6],
            'line-opacity': ['step', ['zoom'], 0, 12, 1],
            // Keyed on a feature property, not on zoom: left alone
            'line-color': ['interpolate', ['linear'], ['get', 'rank'], 1, '#000', 5, '#fff'],
          },
          layout: { 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 14] },
        },
      ]),
      -1,
    ).layers as { paint: Record<string, unknown>; layout: Record<string, unknown> }[]
    expect(layer.paint['line-width']).toEqual(['interpolate', ['exponential', 1.2], ['zoom'], 12, 0.5, 17, 6])
    expect(layer.paint['line-opacity']).toEqual(['step', ['zoom'], 0, 11, 1])
    expect(layer.paint['line-color']).toEqual(['interpolate', ['linear'], ['get', 'rank'], 1, '#000', 5, '#fff'])
    expect(layer.layout['text-size']).toEqual(['interpolate', ['linear'], ['zoom'], 7, 10, 13, 14])
  })

  it('moves zoom comparisons in filters, either way round', () => {
    const [layer] = shiftStyleZoom(
      style([{ id: 'f', filter: ['all', ['>=', ['zoom'], 13], ['<', 10, ['zoom']], ['==', ['get', 'class'], 'minor']] }]),
      -1,
    ).layers as { filter: unknown }[]
    expect(layer.filter).toEqual(['all', ['>=', ['zoom'], 12], ['<', 9, ['zoom']], ['==', ['get', 'class'], 'minor']])
  })

  it('moves the legacy function syntax on zoom, not on a property', () => {
    const [layer] = shiftStyleZoom(
      style([
        {
          id: 'legacy',
          paint: {
            'line-width': { base: 1.4, stops: [[10, 1], [16, 4]] },
            'circle-radius': { property: 'rank', stops: [[1, 2], [5, 6]] },
            'circle-opacity': { property: 'rank', stops: [[{ zoom: 10, value: 1 }, 0.5]] },
          },
        },
      ]),
      -1,
    ).layers as { paint: Record<string, unknown> }[]
    expect(layer.paint['line-width']).toEqual({ base: 1.4, stops: [[9, 1], [15, 4]] })
    expect(layer.paint['circle-radius']).toEqual({ property: 'rank', stops: [[1, 2], [5, 6]] })
    expect(layer.paint['circle-opacity']).toEqual({ property: 'rank', stops: [[{ zoom: 9, value: 1 }, 0.5]] })
  })

  it('leaves the input untouched', () => {
    const input = style([{ id: 'a', minzoom: 5, paint: { 'line-width': ['step', ['zoom'], 1, 8, 2] } }])
    const before = JSON.stringify(input)
    shiftStyleZoom(input, -1)
    expect(JSON.stringify(input)).toBe(before)
  })
})
