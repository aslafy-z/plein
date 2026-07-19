// CartoCiudad geocoder — the Spanish IGN's official geocoding service
// (www.cartociudad.es), the BAN equivalent for Spain.
// `candidates` autocompletes but never carries coordinates (lat/lng arrive as
// 0), so each retained candidate is resolved through `find`, which does.
import { IS_DEV } from '../../lib/env';
import type { GeocodeProvider, GeocodeResult } from '../types';

const BASE =
  (IS_DEV ? '/proxy/cartociudad' : 'https://www.cartociudad.es') + '/geocoder/api/geocoder';
const TIMEOUT_MS = 6000;
const MIN_QUERY = 3;
const MAX_RESULTS = 4;

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
    return { label: address, sublabel, point: { lat: found.lat as number, lng: found.lng as number } };
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
    // Deduplicate labels (`candidates` often lists a town twice as
    // poblacion + Municipio)
    const seen = new Set<string>();
    const out: GeocodeResult[] = [];
    for (const r of resolved) {
      if (r && !seen.has(r.label)) {
        seen.add(r.label);
        out.push(r);
      }
    }
    return out;
  }
}
