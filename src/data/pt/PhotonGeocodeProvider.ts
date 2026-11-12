// Photon (photon.komoot.io), the autocomplete front end to OpenStreetMap data,
// on the public FOSS instance the app already leans on for routing (OSRM /
// Valhalla). It is Portugal's geocoder, and France's backup: the app asks it
// for French addresses only when the Géoplateforme does not answer
// (`FrGeocodeProvider`), so an outage of the national service does not leave
// the French search empty.
//
// Portugal publishes no keyless address geocoder: the DGT serves downloadable
// datasets rather than a search API, and geoapi.pt — the open platform over
// the official CAOP/CTT data — only resolves exact administrative names and
// answers with whole boundary geometries (~250 KB a municipality), which no
// keystroke-by-keystroke search can afford. Photon answers a free-text query
// with coordinates in one request instead.
//
// Results are pinned to one country: `bbox` narrows the search server side,
// and the country code is checked again here because a box overlaps its
// neighbours. For Portugal that is exactly what the price flux covers.
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

/** The country one instance of the provider answers for */
export interface PhotonArea {
  /** [W, S, E, N] */
  bbox: string;
  /** ISO code Photon tags its hits with */
  countryCode: string;
  /** Country the view names in front of the context, when the app has to */
  country?: GeocodeResult['country'];
  /**
   * Whether the context names the commune. Portugal's rows read « Portugal ·
   * district »; a French row has no country in front of it and is told apart
   * by its commune, as the BAN's own labels are (« 31200 Toulouse »).
   */
  communeInContext: boolean;
}

/** Mainland Portugal, the area the DGEG price flux covers */
export const PHOTON_PORTUGAL: PhotonArea = {
  bbox: '-9.6,36.9,-6.1,42.2',
  countryCode: 'PT',
  country: 'pt',
  communeInContext: false,
};

/** Metropolitan France, Corsica included */
export const PHOTON_FRANCE: PhotonArea = {
  bbox: '-5.3,41.2,9.7,51.2',
  countryCode: 'FR',
  communeInContext: true,
};

/**
 * Photon classifies each hit: `city` covers every populated place (city,
 * town, village, municipality), `district` a parish or neighbourhood. What is
 * dropped is what the search box does not offer — `county` / `state` /
 * `country` boundaries (a district's centroid is not a place to drive to) and
 * `other`, the catch-all for unnamed extras.
 */
function kindOf(type: unknown, named: boolean): PlaceKind | null {
  switch (type) {
    case 'city':
    case 'district':
    case 'locality':
      return 'locality';
    case 'street':
      return 'street';
    case 'house':
      // OSM files a point of interest at house level, told from a plain
      // address by the name it carries (« Torre de Belém », « Aeroporto
      // Humberto Delgado »).
      return named ? 'poi' : 'address';
    default:
      return null;
  }
}

/**
 * Named house-level features that are a piece of something rather than a
 * destination: every bus stop, and the platforms and entrances OSM maps
 * around the one station that already answers.
 */
function isFragment(p: PhotonProperties): boolean {
  if (p.osm_key === 'highway') return true;
  return p.osm_key === 'railway' && (p.osm_value === 'stop' || p.osm_value === 'subway_entrance');
}

interface PhotonProperties {
  name?: unknown;
  osm_key?: unknown;
  osm_value?: unknown;
  street?: unknown;
  housenumber?: unknown;
  postcode?: unknown;
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
function describe(
  p: PhotonProperties,
  area: PhotonArea,
): Pick<GeocodeResult, 'label' | 'sublabel' | 'country'> | null {
  const street = str(p.street);
  const housenumber = str(p.housenumber);
  const label =
    str(p.name) ?? (street ? [housenumber, street].filter(Boolean).join(' ') : undefined);
  if (!label) return null;
  const tagged = area.country ? { country: area.country } : {};
  if (area.communeInContext) {
    // « 06000 Nice, Alpes-Maritimes »: the commune, then its département
    // (a postcode on its own, as a town carries, places nothing)
    const city = str(p.city);
    const commune = city ? [str(p.postcode), city].filter(Boolean).join(' ') : '';
    const context = [commune, str(p.county)].filter((v) => v && v !== label).join(', ');
    return { label, sublabel: context, ...tagged };
  }
  // The Portuguese hierarchy Photon exposes: `county` is the district, `city`
  // the municipality. The district identifies a place the way a département
  // does in the BAN; the municipality stands in when a district names itself,
  // and whatever repeats the label carries no information at all.
  const context = [str(p.county), str(p.city)].find((v) => v && v !== label) ?? '';
  return { label, sublabel: context, ...tagged };
}

/**
 * The public instance drops a share of its connections outright (a reset, not
 * an HTTP answer — one request in five when measured). A dropped connection
 * says nothing about the query, so it is asked once more; a refusal the server
 * did answer (429, 5xx) and a timeout are not, they would only be repeated.
 */
async function request(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'TimeoutError') throw reason;
    return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
}

export class PhotonGeocodeProvider implements GeocodeProvider {
  constructor(private readonly area: PhotonArea = PHOTON_PORTUGAL) {}

  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];

    const params = new URLSearchParams({
      q,
      limit: String(FETCH_LIMIT),
      // Local names: a place is searched and read in its own language
      lang: 'default',
      bbox: this.area.bbox,
    });
    const res = await request(`${ENDPOINT}?${params.toString()}`);
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const json = (await res.json()) as { features?: unknown[] };
    const features = Array.isArray(json.features) ? json.features : [];

    const out: GeocodeResult[] = [];
    for (const f of features) {
      if (!f || typeof f !== 'object') continue;
      const props = (f as PhotonFeature).properties ?? {};
      if (str(props.countrycode)?.toUpperCase() !== this.area.countryCode) continue;
      const named = str(props.name) !== undefined;
      const kind = kindOf(props.type, named);
      if (kind === 'poi' && isFragment(props)) continue;
      const p = point(f as PhotonFeature);
      const described = describe(props, this.area);
      if (!kind || !p || !described) continue;
      out.push({ ...described, point: p, kind });
    }
    // Localities first, then points of interest, streets and house numbers —
    // and OSM splits a long street into segments, each of them its own hit,
    // which the shared label deduplication folds back into one suggestion.
    return rankByKind(out, q).slice(0, MAX_RESULTS);
  }
}
