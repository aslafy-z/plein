// The map place search remembers where it has been sent. Fuel searches repeat
// — home, work, the same trip corridor week after week — so a place picked
// once is offered back instead of being retyped and re-geocoded: the whole
// history on an empty query, the entries matching what is being typed above
// the geocoder's own answers.
//
// Pure functions returning data: the panel turns rows into markup, and nothing
// here reaches the network or the clock.
import type { GeocodeResult } from '../data/types';
import type { SearchedPlace } from './persist';

/** Places remembered — about what the capped panel shows without scrolling */
export const MAX_SEARCH_HISTORY = 6;

/**
 * Comparison key of a place label. Accents and case must not split one town in
 * two, and someone typing « chateauroux » means Châteauroux.
 */
function key(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Remember a picked place. A place already in the history moves back to the
 * top instead of being duplicated, and the oldest entries fall off the end.
 */
export function pushSearchIn(
  prev: SearchedPlace[],
  place: GeocodeResult,
  at: number,
): SearchedPlace[] {
  const k = key(place.label);
  return [{ ...place, at }, ...prev.filter((p) => key(p.label) !== k)].slice(0, MAX_SEARCH_HISTORY);
}

/** One row of the suggestion panel, and where it comes from */
export interface SearchRow {
  place: GeocodeResult;
  /** true when the row is a place searched before, not a geocoder hit */
  fromHistory: boolean;
}

/**
 * Rows the panel shows for `query`: the history first — all of it while the
 * query is empty, the entries whose label matches once the user types — then
 * the geocoder's answers minus the places the history already offers. History
 * outranks the geocoder because a place searched before is a place searched
 * again, and it is ordered by when it was last picked rather than by the order
 * storage happens to hold.
 */
export function searchRows(
  history: SearchedPlace[],
  suggestions: GeocodeResult[],
  query: string,
): SearchRow[] {
  const q = key(query);
  const recent = [...history]
    .sort((a, b) => b.at - a.at)
    .filter((p) => !q || key(p.label).includes(q));
  const taken = new Set(recent.map((p) => key(p.label)));
  return [
    ...recent.map((place) => ({ place, fromHistory: true })),
    ...suggestions
      .filter((r) => !taken.has(key(r.label)))
      .map((place) => ({ place, fromHistory: false })),
  ];
}
