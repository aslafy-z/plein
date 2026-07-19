// Photon geocoder — https://photon.komoot.io, OSM-based, worldwide coverage.
// The one free keyless geocoder whose policy allows search-as-you-type, which
// is exactly what PlaceSearch does. Sole geocoder of « Automatique »: one
// ranking for all of Europe (Germany, Andorra, Italy… France and Spain too).
// `lang=fr` localizes labels (« Andorre-la-Vieille, Andorre »).
import { IS_DEV } from '../../lib/env';
import type { GeocodeProvider, GeocodeResult } from '../types';

const ENDPOINT = (IS_DEV ? '/proxy/photon' : 'https://photon.komoot.io') + '/api/';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
const MAX_RESULTS = 6;

interface PhotonFeature {
  properties?: {
    name?: unknown;
    housenumber?: unknown;
    street?: unknown;
    city?: unknown;
    state?: unknown;
    country?: unknown;
  };
  geometry?: {
    coordinates?: unknown;
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function coord(feature: PhotonFeature): { lat: number; lng: number } | null {
  const c = feature.geometry?.coordinates;
  if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[1], lng: c[0] };
  }
  return null;
}

function toResult(feature: PhotonFeature): GeocodeResult | null {
  const point = coord(feature);
  if (!point) return null;
  const p = feature.properties ?? {};
  const street = [str(p.housenumber), str(p.street)].filter(Boolean).join(' ');
  const label = str(p.name) || street;
  if (!label) return null;
  const sublabel = [street !== label ? street : '', str(p.city), str(p.country)]
    .filter(Boolean)
    .join(' · ');
  return { label, sublabel, point };
}

export class PhotonGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];
    const params = new URLSearchParams({ q, limit: String(MAX_RESULTS), lang: 'fr' });
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const json = (await res.json()) as { features?: PhotonFeature[] };
    const features = Array.isArray(json.features) ? json.features : [];
    const out: GeocodeResult[] = [];
    const seen = new Set<string>();
    for (const f of features) {
      const r = toResult(f);
      if (!r) continue;
      const key = `${r.label}|${r.sublabel}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
    return out;
  }
}
