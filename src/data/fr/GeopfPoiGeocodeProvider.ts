// Points of interest for France — the IGN Géoplateforme geocoder
// (data.geopf.fr), `poi` index: the named features of the BD TOPO (airports,
// railway stations, hospitals, stadiums, monuments, mountain passes, rest
// areas…). The BAN only knows addresses, so « Gare Matabiau » or « Aéroport de
// Toulouse-Blagnac » found nothing; this source answers exactly those, and is
// merged next to the BAN rather than in place of it.
import { IS_DEV } from '../../lib/env';
import { rankByKind } from '../geocodeRank';
import type { GeocodeProvider, GeocodeResult } from '../types';

const ENDPOINT = (IS_DEV ? '/proxy/geopf' : 'https://data.geopf.fr') + '/geocodage/search';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
/** Asked for, before filtering — communes and lieux-dits eat into the page */
const FETCH_LIMIT = 15;
// POIs complement the address list, they do not replace it: a handful is
// enough, and the index's tail is generic names (« Pont », « Aire de repos »).
const MAX_RESULTS = 6;
/** Below this the index is matching one stray word of the query */
const MIN_SCORE = 0.3;

/**
 * Categories the index files under `poi` that the BAN already answers as
 * localities — communes, EPCIs, lieux-dits. Offering them twice would only
 * push the real points of interest down the list.
 */
const PLACE_CATEGORIES: ReadonlySet<string> = new Set([
  'administratif',
  'lieu-dit habité',
  'lieu-dit non habité',
]);

interface PoiFeature {
  properties?: {
    toponym?: unknown;
    category?: unknown;
    postcode?: unknown;
    city?: unknown;
    score?: unknown;
  };
  geometry?: { coordinates?: unknown };
}

/** The index answers most fields as arrays (a POI can span postcodes) */
function first(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

function point(f: PoiFeature): { lat: number; lng: number } | null {
  const c = f.geometry?.coordinates;
  if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
  return Math.abs(c[1]) <= 90 ? { lat: c[1], lng: c[0] } : null;
}

function isPlace(category: unknown): boolean {
  return Array.isArray(category) && category.some((c) => PLACE_CATEGORIES.has(c as string));
}

export class GeopfPoiGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];
    const params = new URLSearchParams({ q, index: 'poi', limit: String(FETCH_LIMIT) });
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Géoplateforme HTTP ${res.status}`);
    const json = (await res.json()) as { features?: PoiFeature[] };
    const features = Array.isArray(json.features) ? json.features : [];

    const out: GeocodeResult[] = [];
    for (const f of features) {
      const props = f?.properties ?? {};
      const label = first(props.toponym);
      const p = point(f);
      if (!label || !p || isPlace(props.category)) continue;
      if (typeof props.score === 'number' && props.score < MIN_SCORE) continue;
      // « 31700 Blagnac »: the index names the commune, not the département
      // the BAN's context spells out — the postcode carries it instead.
      const sublabel = [first(props.postcode), first(props.city)].filter(Boolean).join(' ');
      out.push({ label, sublabel, point: p, kind: 'poi' });
    }
    // The BD TOPO draws a bridge or a station as several features of one
    // name; the shared deduplication folds them back into one suggestion.
    return rankByKind(out, q).slice(0, MAX_RESULTS);
  }
}
