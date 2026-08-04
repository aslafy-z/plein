import { describe, expect, it } from 'vitest';
import { decodePolyline6 } from './OsrmRouteProvider';
import type { GeoPoint } from '../../lib/geo';

// Valhalla returns its leg shapes as Google-encoded polylines at 1e-6
// precision. The decoder is the only thing standing between that string and
// the route drawn on the map, so it gets pinned against a reference encoder.

/** Reference Google polyline encoder, 1e-6 precision */
function encodePolyline6(points: GeoPoint[]): string {
  let out = '';
  let lat = 0;
  let lng = 0;
  const chunk = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const la = Math.round(p.lat * 1e6);
    const ln = Math.round(p.lng * 1e6);
    chunk(la - lat);
    chunk(ln - lng);
    lat = la;
    lng = ln;
  }
  return out;
}

describe('decodePolyline6', () => {
  it('decodes the reference Google shape at 1e-6 precision', () => {
    // The polyline-algorithm example, read with six decimals instead of five
    expect(decodePolyline6('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 3.85, lng: -12.02 },
      { lat: 4.07, lng: -12.095 },
      { lat: 4.3252, lng: -12.6453 },
    ]);
  });

  it('round-trips a route shape through the reference encoder', () => {
    // Toulouse → Montauban, roughly
    const shape: GeoPoint[] = [
      { lat: 43.604652, lng: 1.444209 },
      { lat: 43.658, lng: 1.401234 },
      { lat: 43.712345, lng: 1.3599 },
      { lat: 43.9, lng: 1.2 },
      { lat: 44.017584, lng: 1.355166 },
    ];
    const decoded = decodePolyline6(encodePolyline6(shape));
    expect(decoded).toHaveLength(shape.length);
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(shape[i].lat, 6);
      expect(p.lng).toBeCloseTo(shape[i].lng, 6);
    });
  });

  it('round-trips coordinates on both sides of both axes', () => {
    const shape: GeoPoint[] = [
      { lat: 0, lng: 0 },
      { lat: -33.868, lng: 151.209 },
      { lat: 64.1466, lng: -21.9426 },
      { lat: -0.000001, lng: 0.000001 },
    ];
    const decoded = decodePolyline6(encodePolyline6(shape));
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(shape[i].lat, 6);
      expect(p.lng).toBeCloseTo(shape[i].lng, 6);
    });
  });

  it('keeps consecutive identical vertices instead of collapsing them', () => {
    const shape: GeoPoint[] = [
      { lat: 43.6, lng: 1.44 },
      { lat: 43.6, lng: 1.44 },
      { lat: 43.61, lng: 1.45 },
    ];
    expect(decodePolyline6(encodePolyline6(shape))).toHaveLength(3);
  });

  it('decodes a single vertex, and nothing at all from an empty shape', () => {
    expect(decodePolyline6(encodePolyline6([{ lat: 43.604652, lng: 1.444209 }]))).toEqual([
      { lat: 43.604652, lng: 1.444209 },
    ]);
    expect(decodePolyline6('')).toEqual([]);
  });
});
