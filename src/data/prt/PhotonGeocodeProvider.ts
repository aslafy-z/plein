// Geocoder for Portugal — Photon (photon.komoot.io), the autocomplete front
// end to OpenStreetMap data, on the public FOSS instance the app already
// leans on for routing (OSRM / Valhalla).
//
// Portugal publishes no keyless address geocoder: the DGT serves downloadable
// datasets rather than a search API, and geoapi.pt — the open platform over
// the official CAOP/CTT data — only resolves exact administrative names and
// answers with whole boundary geometries (~250 KB a municipality), which no
// keystroke-by-keystroke search can afford. Photon answers a free-text query
// with coordinates in one request instead.
//
// Results are pinned to mainland Portugal: `bbox` narrows the search server
// side, and the country code is checked again here because the box overlaps
// Spain. That is also exactly what the price flux covers.
import { IS_DEV } from '../../lib/env';
import { rankByKind } from '../geocodeRank';
import type { GeocodeProvider, GeocodeResult, PlaceKind } from '../types';

const ENDPOINT = (IS_DEV ? '/proxy/photon' : 'https://photon.komoot.io') + '/api';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
/** Asked for, before filtering — boundaries and POIs eat into the page */
const FETCH_LIMIT = 20;
// The list scrolls and is re-sorted by kind, which needs candidates to work
// with — same reasoning as the other geocoders.
const MAX_RESULTS = 10;

/** Mainland Portugal, the area the DGEG price flux covers [W, S, E, N] */
const BBOX = '-9.6,36.9,-6.1,42.2';

/**
 * Photon classifies each hit: `city` covers every populated place (city,
 * town, village, municipality), `district` a parish or neighbourhood. What is
 * dropped is what the search box does not offer — `county` / `state` /
 * `country` boundaries (a district's centroid is not a place to drive to) and
 * `other`, the catch-all for unnamed extras.
 */
function kindOf(type: unknown): PlaceKind | null {
  switch (type) {
    case 'city':
    case 'district':
    case 'locality':
      return 'locality';
    case 'street':
      return 'street';
    case 'house':
      return 'address';
    default:
      return null;
  }
}

interface PhotonProperties {
  name?: unknown;
  street?: unknown;
  housenumber?: unknown;
  city?: unknown;
  county?: unknown;
  countrycode?: unknown;
  type?: unknown;
}

interface PhotonFeature {
  properties?: PhotonProperties;
  geometry?: { coordinates?: unknown };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function point(f: PhotonFeature): { lat: number; lng: number } | null {
  const c = f.geometry?.coordinates;
  if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
  return Math.abs(c[1]) <= 90 ? { lat: c[1], lng: c[0] } : null;
}

/** "12 Rua Augusta" in "Lisboa" — the view names the country in front of it */
function describe(p: PhotonProperties): Pick<GeocodeResult, 'label' | 'sublabel' | 'country'> | null {
  const street = str(p.street);
  const housenumber = str(p.housenumber);
  const label =
    str(p.name) ?? (street ? [housenumber, street].filter(Boolean).join(' ') : undefined);
  if (!label) return null;
  // The Portuguese hierarchy Photon exposes: `county` is the district, `city`
  // the municipality. The district identifies a place the way a département
  // does in the BAN; the municipality stands in when a district names itself,
  // and whatever repeats the label carries no information at all.
  const context = [str(p.county), str(p.city)].find((v) => v && v !== label) ?? '';
  return { label, sublabel: context, country: 'prt' };
}

export class PhotonGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];

    const params = new URLSearchParams({
      q,
      limit: String(FETCH_LIMIT),
      // Local names: a Portuguese place is searched and read in Portuguese
      lang: 'default',
      bbox: BBOX,
    });
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const json = (await res.json()) as { features?: unknown[] };
    const features = Array.isArray(json.features) ? json.features : [];

    const out: GeocodeResult[] = [];
    for (const f of features) {
      if (!f || typeof f !== 'object') continue;
      const props = (f as PhotonFeature).properties ?? {};
      if (str(props.countrycode)?.toUpperCase() !== 'PT') continue;
      const kind = kindOf(props.type);
      const p = point(f as PhotonFeature);
      const described = describe(props);
      if (!kind || !p || !described) continue;
      out.push({ ...described, point: p, kind });
    }
    // Localities first, then streets, then house numbers — and OSM splits a
    // long street into segments, each of them its own hit, which the shared
    // label deduplication folds back into one suggestion.
    return rankByKind(out).slice(0, MAX_RESULTS);
  }
}
