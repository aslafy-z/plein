import { beforeAll, describe, expect, it } from 'vitest';
import { lerpPoint, type GeoPoint } from '../../lib/geo';
import { VEHICLE_PRESETS } from '../../state/store';
import { ALL_FUELS, SERVICE_TAGS, type Station } from '../types';
import { DemoStationsProvider } from './DemoProviders';

/** A straight line far from every pre-built demo axis (Lille → Strasbourg). */
function offAxisPolyline(): GeoPoint[] {
  const from: GeoPoint = { lat: 50.6292, lng: 3.0573 };
  const to: GeoPoint = { lat: 48.5734, lng: 7.7521 };
  const points: GeoPoint[] = [];
  for (let i = 0; i <= 80; i++) points.push(lerpPoint(from, to, i / 80));
  return points;
}

describe('DemoStationsProvider.getStationsAlong — synthetic corridor stations', () => {
  let synth: Station[] = [];

  beforeAll(async () => {
    const stations = await new DemoStationsProvider().getStationsAlong(offAxisPolyline(), 5);
    synth = stations.filter((s) => s.id.startsWith('synth-'));
  });

  it('fills a route off the pre-built axes with synthetic stops', () => {
    expect(synth.length).toBeGreaterThanOrEqual(3);
  });

  it('prices the default fuel of every vehicle preset', () => {
    for (const s of synth) {
      for (const preset of Object.values(VEHICLE_PRESETS)) {
        expect(s.prices[preset.fuel]?.value, `${s.id} ${preset.fuel}`).toBeGreaterThan(0);
      }
    }
  });

  it('keys its prices by known fuel ids only', () => {
    for (const s of synth) {
      for (const fuel of Object.keys(s.prices)) expect(ALL_FUELS).toContain(fuel);
    }
  });

  it('exposes only valid service tags, so the service filters match', () => {
    for (const s of synth) {
      for (const tag of s.tags) expect(SERVICE_TAGS).toContain(tag);
    }
    expect(synth.some((s) => s.tags.includes('open24h'))).toBe(true);
    expect(synth.some((s) => s.tags.includes('carWash'))).toBe(true);
  });
});
