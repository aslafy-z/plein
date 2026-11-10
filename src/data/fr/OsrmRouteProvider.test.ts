import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodePolyline6, RealRouteProvider } from './OsrmRouteProvider';
import { TravelMatrixUnsupportedError } from '../types';
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

// The public Valhalla instance refuses any matrix whose points lie more than
// 150 km apart. That is a limit, not an outage: the provider must say
// « unsupported » — and must not send the request it knows will be refused.
describe('getTravelMatrix on Valhalla', () => {
  const PARIS: GeoPoint = { lat: 48.8566, lng: 2.3522 };
  const LYON: GeoPoint = { lat: 45.764, lng: 4.8357 };
  const MARSEILLE: GeoPoint = { lat: 43.2965, lng: 5.3698 };
  const TOULOUSE: GeoPoint = { lat: 43.6045, lng: 1.444 };
  const MONTAUBAN: GeoPoint = { lat: 44.0176, lng: 1.355 };
  const provider = new RealRouteProvider();

  const stubFetch = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a matrix over the distance limit as unsupported without sending it', async () => {
    const fetchMock = stubFetch(200, {});
    for (const options of [{ avoidMotorway: true }, { avoidToll: true }, { vehicle: 'motorcycle' as const }]) {
      await expect(
        provider.getTravelMatrix([PARIS, LYON, MARSEILLE], options),
      ).rejects.toBeInstanceOf(TravelMatrixUnsupportedError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still asks Valhalla for a matrix under the limit', async () => {
    const cell = { distance: 50, time: 3000 };
    const fetchMock = stubFetch(200, { sources_to_targets: [[cell, cell], [cell, cell]] });
    const cells = await provider.getTravelMatrix([TOULOUSE, MONTAUBAN], { avoidToll: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('sources_to_targets');
    expect(cells[0][1]).toEqual({ distanceKm: 50, durationMin: 50 });
  });

  it('maps the server-side distance-limit refusal (400, error_code 154) to unsupported', async () => {
    stubFetch(400, {
      error_code: 154,
      error: 'Path distance exceeds the max distance limit: 150000 meters',
      status_code: 400,
      status: 'Bad Request',
    });
    await expect(
      provider.getTravelMatrix([TOULOUSE, MONTAUBAN], { avoidToll: true }),
    ).rejects.toBeInstanceOf(TravelMatrixUnsupportedError);
  });

  it('keeps every other failure a plain error', async () => {
    stubFetch(400, { error_code: 171, error: 'No suitable edges near location' });
    const other = provider.getTravelMatrix([TOULOUSE, MONTAUBAN], { avoidToll: true });
    await expect(other).rejects.toThrow('Valhalla HTTP 400');
    await expect(other).rejects.not.toBeInstanceOf(TravelMatrixUnsupportedError);
    stubFetch(429, {});
    await expect(
      provider.getTravelMatrix([TOULOUSE, MONTAUBAN], { avoidToll: true }),
    ).rejects.not.toBeInstanceOf(TravelMatrixUnsupportedError);
  });

  it('leaves the OSRM path alone: a long plain-car trip is still requested', async () => {
    const fetchMock = stubFetch(200, { code: 'Ok', distances: [[0, 1], [1, 0]], durations: [[0, 60], [60, 0]] });
    await provider.getTravelMatrix([PARIS, MARSEILLE]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/table/');
  });
});
