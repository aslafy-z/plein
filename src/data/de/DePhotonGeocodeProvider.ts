// Geocoder for Germany — Photon (photon.komoot.io), the autocomplete front
// end to OpenStreetMap data, on the public FOSS instance the app already
// leans on for routing (OSRM / Valhalla) and for Portugal.
//
// Germany publishes no keyless national address geocoder: the BKG services
// behind adresse.bund.de require registration, so Photon plays the BAN's role
// here. Results are pinned to Germany: `bbox` narrows the search server side,
// and the country code is checked again because the box overlaps every
// neighbour from France to Poland. That is also exactly what the Tankerkönig
// price flux covers.
//
// Photon needs no key of its own, but it is gated on the price source all the
// same (`deAvailable()`): on a deployment without a German proxy, offering
// German places would only ever land the user on a map with no prices on it.
import { IS_DEV } from '../../lib/env';
import { rankByKind } from '../geocodeRank';
import type { GeocodeProvider, GeocodeResult, PlaceKind } from '../types';
import { deAvailable } from './DeStationsProvider';

const ENDPOINT = (IS_DEV ? '/proxy/photon' : 'https://photon.komoot.io') + '/api';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
/** Asked for, before filtering — boundaries and POIs eat into the page */
const FETCH_LIMIT = 20;
// The list scrolls and is re-sorted by kind, which needs candidates to work
// with — same reasoning as the other geocoders.
const MAX_RESULTS = 10;

/** Germany, the area the Tankerkönig price flux covers [W, S, E, N] */
const BBOX = '5.5,47.1,15.4,55.2';

/**
 * Photon classifies each hit: `city` covers every populated place (city,
 * town, village, municipality), `district` a borough or neighbourhood. What
 * is dropped is what the search box does not offer — `county` / `state` /
 * `country` boundaries (a Bundesland's centroid is not a place to drive to)
 * and `other`, the catch-all for unnamed extras.
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
  state?: unknown;
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

/** "Hauptstraße 12" in "Leipzig" — the view names the country in front of it */
function describe(p: PhotonProperties): Pick<GeocodeResult, 'label' | 'sublabel' | 'country'> | null {
  const street = str(p.street);
  const housenumber = str(p.housenumber);
  const label =
    str(p.name) ?? (street ? [housenumber, street].filter(Boolean).join(' ') : undefined);
  if (!label) return null;
  // A street or address is placed by its municipality (`city`); a city names
  // itself, so its Bundesland (`state`) stands in — and whatever repeats the
  // label carries no information at all.
  const context = [str(p.city), str(p.state)].find((v) => v && v !== label) ?? '';
  return { label, sublabel: context, country: 'de' };
}

export class DePhotonGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    if (!deAvailable()) return [];
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];

    const params = new URLSearchParams({
      q,
      limit: String(FETCH_LIMIT),
      // Local names: a German place is searched and read in German
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
      if (str(props.countrycode)?.toUpperCase() !== 'DE') continue;
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
