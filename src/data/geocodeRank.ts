// Ranking shared by every geocoder: a suggestion list is ordered by what the
// result denotes, not by the order the upstream service happened to return.
// Typing « Bayonne » must offer the town before « rue de Bayonne », because
// this app answers « where are the cheap stations around X » — X is a place
// you drive to, and a locality is the useful centre for a search circle.
import { haversineKm } from '../lib/geo';
import type { GeocodeResult, PlaceKind } from './types';

/** Most useful first. `other` catches anything a source can't classify. */
export const PLACE_KIND_ORDER: readonly PlaceKind[] = ['locality', 'street', 'address', 'other'];

/** Two same-label results closer than this are one place told by two sources */
const SAME_PLACE_KM = 1;

/**
 * Whether `b` is the place `a` already offers. A label alone does not say so:
 * the BAN labels a municipality with its bare name, and « Valence » is three
 * towns (Drôme, Tarn-et-Garonne, Charente) told apart by their context only.
 * Same label and same line under it is a row the user could not tell from the
 * first; same label at the same spot is one place two sources describe in
 * their own words.
 */
function samePlace(a: GeocodeResult, b: GeocodeResult): boolean {
  if (a.label !== b.label) return false;
  if (a.sublabel === b.sublabel && a.country === b.country) return true;
  return haversineKm(a.point, b.point) <= SAME_PLACE_KM;
}

/**
 * Merge several geocoders' lists into one suggestion list: all localities
 * first, then streets, then house numbers, and inside one kind the sources
 * are interleaved in the order given so every country stays visible near the
 * top. Each source's own relevance order is preserved within its kind, and a
 * place already emitted is skipped (the sources overlap near the borders, and
 * CartoCiudad lists a town twice as poblacion + Municipio) — a place, not a
 * label: homonymous towns each keep their row (see `samePlace`).
 */
export function mergeByKind(lists: GeocodeResult[][]): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  const seen = new Map<string, GeocodeResult[]>();
  for (const kind of PLACE_KIND_ORDER) {
    const tier = lists.map((list) => list.filter((r) => r.kind === kind));
    const depth = Math.max(0, ...tier.map((list) => list.length));
    for (let i = 0; i < depth; i++) {
      for (const list of tier) {
        const r = list[i];
        if (!r) continue;
        const twins = seen.get(r.label);
        if (twins?.some((kept) => samePlace(kept, r))) continue;
        if (twins) twins.push(r);
        else seen.set(r.label, [r]);
        out.push(r);
      }
    }
  }
  return out;
}

/** Single-source flavour of `mergeByKind`: reorder and deduplicate one list. */
export function rankByKind(results: GeocodeResult[]): GeocodeResult[] {
  return mergeByKind([results]);
}
