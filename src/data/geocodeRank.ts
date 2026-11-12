// Ranking shared by every geocoder: a suggestion list is ordered by what the
// result denotes, not by the order the upstream service happened to return.
// Typing « Bayonne » must offer the town before « rue de Bayonne », because
// this app answers « where are the cheap stations around X » — X is a place
// you drive to, and a locality is the useful centre for a search circle.
//
// What a result denotes only breaks ties, though: how much of the QUERY a
// result answers comes first (`queryCoverage`). The kind order alone put any
// point of interest and any street above every house number, so a full
// address typed in « Automatic » came after another country's shops and
// streets sharing one word with it.
import { haversineKm } from '../lib/geo';
import type { GeocodeResult, PlaceKind } from './types';

/**
 * Most useful first. A point of interest sits between the town and the
 * streets: « Bayonne » still offers the town first, and « Gare de Bayonne » is
 * a destination in its own right, where « Rue de la Gare » rarely is. `other`
 * catches anything a source can't classify.
 */
export const PLACE_KIND_ORDER: readonly PlaceKind[] = [
  'locality',
  'poi',
  'street',
  'address',
  'other',
];

/** Lowercase, accents folded, split on anything that is not a letter or digit */
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Share of the query's words a result says, 0 to 1 — in its label or in the
 * line under it, since sources split a place differently (« Bayonne 64 » is a
 * label and a context for the BAN). The last word is still being typed, so it
 * matches as a prefix; the others must be whole words, or « paste » would
 * credit every « Pasteur ».
 *
 * This is deliberately not a similarity score. The sources have already done
 * the fuzzy matching — a typo that matches no word leaves every result at 0
 * and the list in the order it had. It only tells apart, across services
 * whose own scores cannot be compared, the result that answers the whole
 * query from the one that shares a word with it.
 */
export function queryCoverage(query: string, result: GeocodeResult): number {
  const asked = words(query);
  if (asked.length === 0) return 0;
  const said = words(`${result.label} ${result.sublabel}`);
  const whole = new Set(said);
  let matched = 0;
  asked.forEach((word, i) => {
    const typing = i === asked.length - 1;
    if (whole.has(word) || (typing && said.some((w) => w.startsWith(word)))) matched++;
  });
  return matched / asked.length;
}

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
 * first, then points of interest, streets and house numbers, and inside one
 * kind the sources are interleaved in the order given so every country stays
 * visible near the top. Each source's own relevance order is preserved within
 * its kind, and a place already emitted is skipped (the sources overlap near
 * the borders, and CartoCiudad lists a town twice as poblacion + Municipio) —
 * a place, not a label: homonymous towns each keep their row (see
 * `samePlace`).
 *
 * With the `query` the lists answer, that order only settles the results
 * saying the same share of it: the ones saying more of its words come first
 * (`queryCoverage`).
 *
 * The first `lead` lists are the home ones — the country the map is looking
 * at. Inside one kind their results come whole, before the others interleave:
 * a priority among equals, which never lifts a street above a town nor a
 * partial match above the result that says the whole query.
 */
export function mergeByKind(
  lists: GeocodeResult[][],
  query?: string,
  lead = 0,
): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  const seen = new Map<string, GeocodeResult[]>();
  const emit = (r: GeocodeResult | undefined) => {
    if (!r) return;
    const twins = seen.get(r.label);
    if (twins?.some((kept) => samePlace(kept, r))) return;
    if (twins) twins.push(r);
    else seen.set(r.label, [r]);
    out.push(r);
  };
  for (const kind of PLACE_KIND_ORDER) {
    const tier = lists.map((list) => list.filter((r) => r.kind === kind));
    for (const list of tier.slice(0, lead)) list.forEach(emit);
    const rest = tier.slice(lead);
    const depth = Math.max(0, ...rest.map((list) => list.length));
    for (let i = 0; i < depth; i++) {
      for (const list of rest) emit(list[i]);
    }
  }
  if (!query) return out;
  // Array.prototype.sort is stable: equal coverage keeps the order built above
  const coverage = new Map(out.map((r) => [r, queryCoverage(query, r)]));
  return out.sort((a, b) => coverage.get(b)! - coverage.get(a)!);
}

/** Single-source flavour of `mergeByKind`: reorder and deduplicate one list. */
export function rankByKind(results: GeocodeResult[], query?: string): GeocodeResult[] {
  return mergeByKind([results], query);
}
