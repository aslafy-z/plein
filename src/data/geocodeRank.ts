// Ranking shared by every geocoder: a suggestion list is ordered by what the
// result denotes, not by the order the upstream service happened to return.
// Typing « Bayonne » must offer the town before « rue de Bayonne », because
// this app answers « where are the cheap stations around X » — X is a place
// you drive to, and a locality is the useful centre for a search circle.
import type { GeocodeResult, PlaceKind } from './types';

/** Most useful first. `other` catches anything a source can't classify. */
export const PLACE_KIND_ORDER: readonly PlaceKind[] = ['locality', 'street', 'address', 'other'];

/**
 * Merge several geocoders' lists into one suggestion list: all localities
 * first, then streets, then house numbers, and inside one kind the sources
 * are interleaved in the order given so every country stays visible near the
 * top. Each source's own relevance order is preserved within its kind, and a
 * label already emitted is skipped (the sources overlap near the borders, and
 * CartoCiudad lists a town twice as poblacion + Municipio).
 */
export function mergeByKind(lists: GeocodeResult[][]): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const kind of PLACE_KIND_ORDER) {
    const tier = lists.map((list) => list.filter((r) => r.kind === kind));
    const depth = Math.max(0, ...tier.map((list) => list.length));
    for (let i = 0; i < depth; i++) {
      for (const list of tier) {
        const r = list[i];
        if (r && !seen.has(r.label)) {
          seen.add(r.label);
          out.push(r);
        }
      }
    }
  }
  return out;
}

/** Single-source flavour of `mergeByKind`: reorder and deduplicate one list. */
export function rankByKind(results: GeocodeResult[]): GeocodeResult[] {
  return mergeByKind([results]);
}
