// CartoCiudad geocoder — the Spanish IGN's official geocoding service
// (www.cartociudad.es), the BAN equivalent for Spain.
// `candidates` autocompletes but never carries coordinates (lat/lng arrive as
// 0), so each retained candidate is resolved through `find`, which does.
import { IS_DEV } from '../../lib/env';
import { rankByKind } from '../geocodeRank';
import type { GeocodeProvider, GeocodeResult, PlaceKind } from '../types';

const BASE =
  (IS_DEV ? '/proxy/cartociudad' : 'https://www.cartociudad.es') + '/geocoder/api/geocoder';
// The geocoder goes through slow spells (whole seconds per request); a short
// timeout turned those into a dead Spanish search, so give it real room.
const TIMEOUT_MS = 10_000;
const MIN_QUERY = 3;
// Each retained candidate costs one extra `find` request, so this cap is the
// concurrency against a geocoder that already has slow spells — but the list
// scrolls now, and 4 suggestions for a whole country was thin.
const MAX_RESULTS = 8;

/**
 * CartoCiudad `type` — a geographic taxonomy rather than an address one:
 * « Municipio » / « poblacion » / « toponimo » for places, « callejero » for a
 * street and « carretera » for a road, « portal » for a house number.
 */
function kindOf(type: unknown): PlaceKind {
  switch (typeof type === 'string' ? type.toLowerCase() : '') {
    case 'municipio':
    case 'poblacion':
    case 'provincia':
    case 'comunidad autonoma':
    case 'toponimo':
    case 'ngbe':
      return 'locality';
    case 'callejero':
    case 'carretera':
      return 'street';
    case 'portal':
    case 'punto_kilometrico':
    case 'refcatastral':
      return 'address';
    default:
      return 'other';
  }
}

interface Candidate {
  address?: unknown;
  muni?: unknown;
  province?: unknown;
  type?: unknown;
  lat?: unknown;
  lng?: unknown;
}

function isPoint(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0) &&
    Math.abs(lat) <= 90
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`CartoCiudad HTTP ${res.status}`);
  return res.json();
}

/** Resolve one candidate's coordinates via `find`; null when it can't. */
async function resolve(c: Candidate): Promise<GeocodeResult | null> {
  const address = typeof c.address === 'string' ? c.address : '';
  if (!address) return null;
  const province = typeof c.province === 'string' ? c.province : '';
  const muni = typeof c.muni === 'string' ? c.muni : '';
  const sublabel = [muni && muni !== address ? muni : '', province]
    .filter(Boolean)
    .join(' · ');
  try {
    const params = new URLSearchParams({ q: address });
    if (typeof c.type === 'string' && c.type) params.set('type', c.type);
    const found = (await fetchJson(`${BASE}/find?${params.toString()}`)) as Candidate | null;
    if (!found || !isPoint(found.lat, found.lng)) return null;
    return {
      label: address,
      sublabel,
      point: { lat: found.lat as number, lng: found.lng as number },
      kind: kindOf(c.type),
    };
  } catch {
    return null;
  }
}

export class CartoCiudadGeocodeProvider implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];
    const params = new URLSearchParams({ q, limit: String(MAX_RESULTS) });
    const json = await fetchJson(`${BASE}/candidates?${params.toString()}`);
    const candidates = Array.isArray(json) ? (json as Candidate[]) : [];
    const resolved = await Promise.all(candidates.slice(0, MAX_RESULTS).map(resolve));
    // rankByKind also deduplicates labels — `candidates` often lists a town
    // twice as poblacion + Municipio.
    return rankByKind(resolved.filter((r): r is GeocodeResult => r !== null));
  }
}
