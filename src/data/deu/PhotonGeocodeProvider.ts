// Photon geocoder (photon.komoot.io) — OSM-backed, built for search-as-you-type,
// keyless and CORS-open: the BAN equivalent for Germany. The query is bounded
// to the German bbox and results are filtered to countrycode DE so the
// standalone « deu » source doesn't answer with places abroad.
import { IS_DEV } from '../../lib/env';
import type { GeocodeProvider, GeocodeResult } from '../types';

const BASE = (IS_DEV ? '/proxy/photon' : 'https://photon.komoot.io') + '/api/';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
const MAX_RESULTS = 6;
/** minLon,minLat,maxLon,maxLat — Germany incl. margins */
const DEU_BBOX = '5.5,47.1,15.4,55.2';

interface PhotonProps {
  name?: unknown;
  street?: unknown;
  housenumber?: unknown;
  city?: unknown;
  state?: unknown;
  countrycode?: unknown;
}

interface PhotonFeature {
  properties?: PhotonProps;
  geometry?: { coordinates?: unknown };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function toResult(f: PhotonFeature): GeocodeResult | null {
  const p = f.properties ?? {};
  if (str(p.countrycode)?.toUpperCase() !== 'DE') return null;
  const coords = f.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = coords[0];
  const lat = coords[1];
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90) return null;

  const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ');
  const label = str(p.name) ?? street;
  if (!label) return null;
  const city = str(p.city);
  const state = str(p.state);
  const sublabel = [city && city !== label ? city : '', state && state !== label ? state : '']
    .filter(Boolean)
    .join(' · ');
  return { label, sublabel: sublabel || 'Allemagne', point: { lat, lng } };
}

export class PhotonGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];
    const params = new URLSearchParams({
      q,
      limit: String(MAX_RESULTS * 2), // room for the DE filter below
      lang: 'fr',
      bbox: DEU_BBOX,
    });
    const res = await fetch(`${BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const json = (await res.json()) as { features?: unknown[] };
    const features = Array.isArray(json.features) ? (json.features as PhotonFeature[]) : [];

    const seen = new Set<string>();
    const out: GeocodeResult[] = [];
    for (const f of features) {
      const r = toResult(f);
      if (r && !seen.has(r.label)) {
        seen.add(r.label);
        out.push(r);
      }
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }
}
