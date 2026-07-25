import { afterEach, describe, expect, it, vi } from 'vitest';
import { haversineKm } from '../../lib/geo';
import type { Station } from '../types';
import { enrichWithBrands, type FuelPoi } from './osmBrands';

const MATCH_KM = 0.15;

function station(id: string, lat: number, lng: number, city = 'Toulouse'): Station {
  return {
    id,
    name: `Station · ${city}`,
    init: 'ST',
    lat,
    lng,
    address: '1 rue du Test',
    city,
    prices: {},
    tags: [],
    services: [],
    highway: false,
  };
}

/** Metres, expressed as a latitude offset (≈111.19 km per degree) */
function m(metres: number): number {
  return metres / 111_194.9;
}

/** Metres, expressed as a longitude offset at the given latitude */
function mLng(metres: number, lat: number): number {
  return m(metres) / Math.cos((lat * Math.PI) / 180);
}

/**
 * The pre-index implementation, kept verbatim as the oracle the spatial index
 * has to agree with.
 */
function enrichByFullScan(stations: Station[], pois: FuelPoi[]): Station[] {
  if (!pois.length) return stations;
  const matches = stations.map((s) => {
    let best: FuelPoi | null = null;
    let bestKm = Infinity;
    let labeled: FuelPoi | null = null;
    let labeledKm = Infinity;
    for (const p of pois) {
      const d = haversineKm({ lat: s.lat, lng: s.lng }, p);
      if (d < bestKm) {
        bestKm = d;
        best = p;
      }
      if (p.label && d < labeledKm) {
        labeledKm = d;
        labeled = p;
      }
    }
    if (!best || bestKm > MATCH_KM) return null;
    return { poi: best, km: bestKm, label: labeled && labeledKm <= MATCH_KM ? labeled.label : '' };
  });
  const closestKm = new Map<FuelPoi, number>();
  for (const mm of matches) {
    if (mm && mm.km < (closestKm.get(mm.poi) ?? Infinity)) closestKm.set(mm.poi, mm.km);
  }
  return stations.map((s, i) => {
    const mm = matches[i];
    if (!mm) return s;
    const snap = closestKm.get(mm.poi) === mm.km ? { lat: mm.poi.lat, lng: mm.poi.lng } : {};
    if (!mm.label) return { ...s, ...snap };
    const city = s.city ? s.name.split('·').pop()?.trim() : '';
    return {
      ...s,
      brand: mm.label,
      name: city ? `${mm.label} · ${city}` : mm.label,
      init: initialsForTest(mm.label),
      ...snap,
    };
  });
}

// A stand-in so the oracle stays self-contained; the real helper lives in
// src/lib/text.ts and is exercised through enrichWithBrands below.
function initialsForTest(label: string): string {
  const words = label.split(/[\s·-]+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

/**
 * Pads a POI list with far-away filler. The index falls back to a full scan
 * when walking the cells would cost more than walking the POIs, so a two-POI
 * fixture would never reach the grid code the test is aiming at.
 */
function pad(pois: FuelPoi[]): FuelPoi[] {
  const filler = Array.from({ length: 16 }, (_, i) => ({
    lat: 10 + i * 0.5,
    lng: 10 + i * 0.5,
    label: i % 2 ? 'Filler' : '',
  }));
  return [...pois, ...filler];
}

/** Deterministic LCG — no Math.random, so a failure is always reproducible */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('enrichWithBrands', () => {
  it('adopts the brand and snaps to the POI within the match radius', () => {
    const poi: FuelPoi = { lat: 43.6047, lng: 1.4442, label: 'Carrefour' };
    // ~50 m off — the kind of drift the gouv geocoder produces
    const [out] = enrichWithBrands([station('a', poi.lat + m(50), poi.lng)], [poi]);
    expect(out.brand).toBe('Carrefour');
    expect(out.name).toBe('Carrefour · Toulouse');
    expect(out.init).toBe('CA');
    expect(out.lat).toBe(poi.lat);
    expect(out.lng).toBe(poi.lng);
  });

  it('leaves a station further than the match radius untouched', () => {
    const poi: FuelPoi = { lat: 43.6047, lng: 1.4442, label: 'Carrefour' };
    const s = station('a', poi.lat + m(400), poi.lng);
    expect(enrichWithBrands([s], [poi])[0]).toEqual(s);
  });

  it('returns the stations untouched when the index is empty', () => {
    const stations = [station('a', 43.6, 1.44)];
    expect(enrichWithBrands(stations, [])).toBe(stations);
  });

  it('takes the position from the nearest POI and the brand from the nearest labeled one', () => {
    const unlabeled: FuelPoi = { lat: 43.6047, lng: 1.4442, label: '' };
    const branded: FuelPoi = { lat: 43.6047 + m(100), lng: 1.4442, label: 'TotalEnergies' };
    const [out] = enrichWithBrands([station('a', unlabeled.lat + m(20), unlabeled.lng)], [
      unlabeled,
      branded,
    ]);
    expect(out.brand).toBe('TotalEnergies');
    expect(out.lat).toBe(unlabeled.lat);
  });

  it('snaps only the closest of several stations matching the same POI', () => {
    const poi: FuelPoi = { lat: 43.6047, lng: 1.4442, label: 'Esso' };
    const near = station('near', poi.lat + m(20), poi.lng);
    const far = station('far', poi.lat + m(80), poi.lng);
    const [outNear, outFar] = enrichWithBrands([near, far], [poi]);
    expect(outNear.lat).toBe(poi.lat);
    expect(outFar.lat).toBe(far.lat);
    // Both still take the brand — only the pin stays put
    expect(outNear.brand).toBe('Esso');
    expect(outFar.brand).toBe('Esso');
  });

  it('matches across a grid cell boundary, right out to the match radius', () => {
    // The lopsided offsets (140 m one side, 5 m the other — 145 m apart, just
    // inside the radius) pin the search window: anything narrower stops short
    // of the neighbouring cell and the match is silently lost.
    const LAT_EDGE = 43.6; // both are multiples of the 0.02° cell side
    const LNG_EDGE = 1.44;
    const cases: Array<[FuelPoi, Station]> = [
      [
        { lat: LAT_EDGE + m(5), lng: 1.4442, label: 'Avia' },
        station('a', LAT_EDGE - m(140), 1.4442),
      ],
      [
        { lat: LAT_EDGE - m(5), lng: 1.4442, label: 'Avia' },
        station('a', LAT_EDGE + m(140), 1.4442),
      ],
      [
        { lat: 43.6047, lng: LNG_EDGE + mLng(5, 43.6047), label: 'Avia' },
        station('a', 43.6047, LNG_EDGE - mLng(140, 43.6047)),
      ],
      [
        { lat: 43.6047, lng: LNG_EDGE - mLng(5, 43.6047), label: 'Avia' },
        station('a', 43.6047, LNG_EDGE + mLng(140, 43.6047)),
      ],
    ];
    for (const [poi, s] of cases) {
      expect(haversineKm({ lat: s.lat, lng: s.lng }, poi)).toBeLessThan(MATCH_KM);
      expect(enrichWithBrands([s], pad([poi]))[0].brand).toBe('Avia');
    }
  });

  it('agrees with a full scan on a dense random field', () => {
    const rand = rng(20260724);
    const labels = ['', 'Carrefour', 'TotalEnergies', 'Intermarché', '', 'Leclerc', 'Shell'];
    // A ~11 km × 11 km patch: at 400 POIs the spacing is far below the 150 m
    // match radius, so ties, multi-candidate cells and near-misses all occur.
    const pois: FuelPoi[] = Array.from({ length: 400 }, (_, i) => ({
      lat: 43.55 + rand() * 0.1,
      lng: 1.4 + rand() * 0.1,
      label: labels[i % labels.length],
    }));
    // Half the stations sit on a POI (± a few metres), half sit anywhere in the
    // patch — the second half exercises the "no match" path.
    const stations: Station[] = Array.from({ length: 300 }, (_, i) => {
      if (i % 2 === 0) {
        const p = pois[Math.floor(rand() * pois.length)];
        return station(`s${i}`, p.lat + (rand() - 0.5) * m(300), p.lng + (rand() - 0.5) * m(300));
      }
      return station(`s${i}`, 43.55 + rand() * 0.1, 1.4 + rand() * 0.1);
    });
    expect(enrichWithBrands(stations, pois)).toEqual(enrichByFullScan(stations, pois));
    // Sanity: the fixture actually produces matches, so the equality means something
    const enriched = enrichWithBrands(stations, pois).filter((s) => s.brand).length;
    expect(enriched).toBeGreaterThan(20);
  });

  it('breaks a tie spanning two cells by list order, like a full scan', () => {
    // Equidistant POIs either side of a cell boundary: the grid visits the
    // lower cell first, so only replaying the list order keeps the first POI.
    const EDGE = 43.6;
    const pois = pad([
      { lat: EDGE + m(50), lng: 1.4442, label: 'Shell' }, // upper cell, listed first
      { lat: EDGE - m(50), lng: 1.4442, label: 'Esso' }, // lower cell, visited first
    ]);
    const stations = [station('a', EDGE, 1.4442)];
    const [out] = enrichWithBrands(stations, pois);
    expect(enrichWithBrands(stations, pois)).toEqual(enrichByFullScan(stations, pois));
    expect(out.brand).toBe('Shell');
    expect(out.lat).toBe(pois[0].lat);
  });

  it('agrees with a full scan on duplicate POIs at identical coordinates', () => {
    // Same spot, three rows: tie-breaking must stay "first in the list wins".
    const pois: FuelPoi[] = [
      { lat: 43.6047, lng: 1.4442, label: 'Shell' },
      { lat: 43.6047, lng: 1.4442, label: 'Esso' },
      { lat: 43.6047, lng: 1.4442, label: '' },
    ];
    const stations = [station('a', 43.6047 + m(30), 1.4442), station('b', 43.6047, 1.4442)];
    expect(enrichWithBrands(stations, pois)).toEqual(enrichByFullScan(stations, pois));
    expect(enrichWithBrands(stations, pois)[0].brand).toBe('Shell');
  });

  it('returns a non-finite station untouched instead of hanging', () => {
    // An infinite latitude makes every cell bound infinite, and `la++` never
    // leaves Infinity — without a guard the cell walk spins forever. The test
    // times out rather than fails if that ever comes back.
    const pois = pad([{ lat: 43.6047, lng: 1.4442, label: 'Total' }]);
    const stations = [
      station('nan', Number.NaN, 1.4442),
      station('inf', Number.POSITIVE_INFINITY, 1.4442),
      station('-inf', Number.NEGATIVE_INFINITY, 1.4442),
      station('inf-lng', 43.6047, Number.POSITIVE_INFINITY),
      station('ok', 43.6047, 1.4442),
    ];
    const out = enrichWithBrands(stations, pois);
    expect(out).toEqual(enrichByFullScan(stations, pois));
    expect(out.slice(0, 4)).toEqual(stations.slice(0, 4)); // untouched, no match
    expect(out[4].brand).toBe('Total'); // the sane one still matches
  }, 5_000);

  it('agrees with a full scan far from the equator and around the poles', () => {
    // Not places this app serves, but the cell arithmetic must not silently
    // drop matches where meridians converge.
    const cases: Array<[number, number]> = [
      [78.22, 15.65], // Longyearbyen
      [-33.87, 151.21], // Sydney
      [89.999, 42], // where a 150 m window wraps most of the globe
      [0, -0.001], // straddling both zero lines
    ];
    for (const [lat, lng] of cases) {
      const pois: FuelPoi[] = [
        { lat, lng, label: 'Circle K' },
        { lat: lat - m(60), lng, label: '' },
      ];
      const stations = [station('a', lat - m(40), lng, 'Nulle part')];
      expect(enrichWithBrands(stations, pois)).toEqual(enrichByFullScan(stations, pois));
      expect(enrichWithBrands(stations, pois)[0].brand).toBe('Circle K');
    }
  });

  it('matches across the antimeridian', () => {
    // ~106 m apart, on opposite sides of the ±180° seam.
    const pois = pad([{ lat: -16.92, lng: 179.9995, label: 'Circle K' }]);
    const stations = [station('a', -16.92, -179.9995, 'Nulle part')];
    expect(haversineKm({ lat: -16.92, lng: -179.9995 }, pois[0])).toBeLessThan(MATCH_KM);
    expect(enrichWithBrands(stations, pois)).toEqual(enrichByFullScan(stations, pois));
    expect(enrichWithBrands(stations, pois)[0].brand).toBe('Circle K');
  });
});

describe('fuelPoisNear', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Reloads the module so each test gets a fresh (unmemoized) index */
  async function withIndex(pois: FuelPoi[]) {
    const labels = [...new Set(pois.map((p) => p.label))];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          labels,
          pois: pois.map((p) => [p.lat, p.lng, labels.indexOf(p.label)]),
        }),
      })),
    );
    vi.resetModules();
    return import('./osmBrands');
  }

  it('keeps every POI within the radius (+1 km) and nothing beyond', async () => {
    const center = { lat: 43.6047, lng: 1.4442 };
    const rand = rng(7);
    // A 4° box around Toulouse — the latitude prefilter must not clip a POI
    // that the haversine would have kept.
    const pois: FuelPoi[] = Array.from({ length: 2000 }, () => ({
      lat: center.lat - 2 + rand() * 4,
      lng: center.lng - 2 + rand() * 4,
      label: '',
    }));
    const { fuelPoisNear } = await withIndex(pois);
    for (const radiusKm of [0, 5, 25, 100]) {
      const want = pois.filter((p) => haversineKm(center, p) <= radiusKm + 1);
      expect(await fuelPoisNear(center, radiusKm)).toEqual(want);
    }
    // The widest radius must actually keep a chunk of the box — and drop the rest
    const wide = await fuelPoisNear(center, 100);
    expect(wide.length).toBeGreaterThan(20);
    expect(wide.length).toBeLessThan(pois.length);
  });
});
