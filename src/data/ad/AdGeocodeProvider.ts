// Official Andorran geocoder — the Govern d'Andorra's IDE locators on
// sig.govern.ad (same ArcGIS server as the fuel prices):
// « nomenclator2025v2 », the official gazetteer of place names, plus
// « LocatorIDE » for street addresses. `suggest` autocompletes (accent
// tolerant); each retained suggestion resolves through
// `findAddressCandidates` (its magicKey) into WGS84 coordinates — the same
// two-step pattern as CartoCiudad for Spain.
import { IS_DEV } from '../../lib/env';
import { rankByKind } from '../geocodeRank';
import type { GeocodeProvider, GeocodeResult, GeocodeSearchOptions, PlaceKind } from '../types';

const BASE = (IS_DEV ? '/proxy/ad' : 'https://sig.govern.ad') + '/server/rest/services/IDE';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
/** Suggestions pulled per locator — place names first, streets as a bonus */
const PLACES_MAX = 6;
const STREETS_MAX = 4;
const MAX_RESULTS = 10;

interface Suggestion {
  text: string;
  magicKey: string;
  locator: string;
  kind: PlaceKind;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`IDE Andorra HTTP ${res.status}`);
  return res.json();
}

/**
 * "el Pas de la Casa, Encamp" → label + the parish alone. Naming the country
 * in front of it is the view's job (`placeSublabel`): « Andorra » is a word
 * the app chooses, not one the flux returns.
 */
function splitLabel(text: string): Pick<GeocodeResult, 'label' | 'sublabel' | 'country'> {
  const i = text.lastIndexOf(',');
  const label = (i > 0 ? text.slice(0, i) : text).trim();
  const parish = i > 0 ? text.slice(i + 1).trim() : '';
  return { label, sublabel: parish !== label ? parish : '', country: 'ad' };
}

async function suggest(
  locator: string,
  q: string,
  max: number,
  kind: PlaceKind,
): Promise<Suggestion[]> {
  const params = new URLSearchParams({ text: q, maxSuggestions: String(max), f: 'json' });
  const json = (await fetchJson(`${BASE}/${locator}/GeocodeServer/suggest?${params}`)) as {
    suggestions?: unknown[];
  };
  const list = Array.isArray(json.suggestions) ? json.suggestions : [];
  const out: Suggestion[] = [];
  for (const s of list.slice(0, max)) {
    const text = (s as { text?: unknown }).text;
    const magicKey = (s as { magicKey?: unknown }).magicKey;
    if (typeof text === 'string' && text && typeof magicKey === 'string' && magicKey) {
      out.push({ text, magicKey, locator, kind });
    }
  }
  return out;
}

/** A resolve call that failed — as opposed to one that answered « no point ». */
const FAILED = Symbol('resolve failed');

/**
 * Resolve one suggestion's coordinates; null when it has none, and `FAILED`
 * when the request itself failed.
 */
async function resolve(s: Suggestion): Promise<GeocodeResult | null | typeof FAILED> {
  try {
    const params = new URLSearchParams({
      SingleLine: s.text,
      magicKey: s.magicKey,
      outSR: '4326',
      maxLocations: '1',
      f: 'json',
    });
    const json = (await fetchJson(
      `${BASE}/${s.locator}/GeocodeServer/findAddressCandidates?${params}`,
    )) as { candidates?: { location?: { x?: unknown; y?: unknown } }[] };
    const loc = json.candidates?.[0]?.location;
    const lat = loc?.y;
    const lng = loc?.x;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90) return null;
    return { ...splitLabel(s.text), point: { lat, lng }, kind: s.kind };
  } catch {
    return FAILED;
  }
}

export class AdGeocodeProvider implements GeocodeProvider {
  async search(query: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];

    const [places, streets] = await Promise.allSettled([
      suggest('nomenclator2025v2', q, PLACES_MAX, 'locality'),
      suggest('LocatorIDE', q, STREETS_MAX, 'street'),
    ]);
    if (places.status === 'rejected' && streets.status === 'rejected') throw places.reason;
    const merged = [
      ...(places.status === 'fulfilled' ? places.value : []),
      ...(streets.status === 'fulfilled' ? streets.value : []),
    ];

    const resolved = await Promise.all(merged.map(resolve));
    // The resolve step going down behind healthy suggestions is an outage, not
    // « no result »: with nothing resolved the search fails like any other
    // request, and a list missing a locator or some rows says it is partial.
    const failures = resolved.filter((r) => r === FAILED).length;
    if (failures > 0 && failures === resolved.length) throw new Error('IDE Andorra resolve failed');
    if (failures > 0 || places.status === 'rejected' || streets.status === 'rejected') {
      opts?.onIncomplete?.();
    }
    const ranked = rankByKind(
      resolved.filter((r): r is GeocodeResult => r !== null && r !== FAILED),
    );
    return ranked.slice(0, MAX_RESULTS);
  }
}
