// Base Adresse Nationale geocoder — https://api-adresse.data.gouv.fr
import { IS_DEV } from '../../lib/env';
import { rankByKind } from '../geocodeRank';
import type { GeocodeProvider, GeocodeResult, PlaceKind } from '../types';

const ENDPOINT = (IS_DEV ? '/proxy/ban' : 'https://api-adresse.data.gouv.fr') + '/search/';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
// The list scrolls, so ask for more than a screenful: the BAN sorts by
// relevance and we then re-sort by kind, which needs candidates to work with.
const MAX_RESULTS = 12;

interface BanFeature {
  properties?: {
    label?: unknown;
    context?: unknown;
    city?: unknown;
    type?: unknown;
  };
  geometry?: {
    coordinates?: unknown;
  };
}

/** BAN `type`: municipality | locality (lieu-dit) | street | housenumber */
function kindOf(type: unknown): PlaceKind {
  switch (type) {
    case 'municipality':
    case 'locality':
      return 'locality';
    case 'street':
      return 'street';
    case 'housenumber':
      return 'address';
    default:
      return 'other';
  }
}

function coord(feature: BanFeature): { lat: number; lng: number } | null {
  const c = feature.geometry?.coordinates;
  if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[1], lng: c[0] };
  }
  return null;
}

export class BanGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];
    const params = new URLSearchParams({ q, limit: String(MAX_RESULTS) });
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`BAN HTTP ${res.status}`);
    const json = (await res.json()) as { features?: BanFeature[] };
    const features = Array.isArray(json.features) ? json.features : [];
    const out: GeocodeResult[] = [];
    for (const f of features) {
      const point = coord(f);
      const label = f.properties?.label;
      if (!point || typeof label !== 'string') continue;
      const context = f.properties?.context;
      const city = f.properties?.city;
      const sublabel =
        typeof context === 'string' ? context : typeof city === 'string' ? city : '';
      out.push({ label, sublabel, point, kind: kindOf(f.properties?.type) });
    }
    return rankByKind(out);
  }
}
