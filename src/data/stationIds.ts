// ── Station ids ──────────────────────────────────────────────────────────────
// Every station id carries the country that issued it — `fr-31000009`,
// `es-1234`, `ad-42`, `pt-67360` — so a mixed « Automatic » list stays
// attributable (source footer, SP95-for-E10 substitution) without asking the
// provider. Demo ids ('su', 'r-a62'…) are deliberately outside that scheme.

export type StationCountry = 'fr' | 'es' | 'ad' | 'pt';

const PREFIXES: StationCountry[] = ['fr', 'es', 'ad', 'pt'];

/** Country that issued the id, or null for ids outside the scheme (demo) */
export function stationCountry(id: string): StationCountry | null {
  return PREFIXES.find((c) => id.startsWith(`${c}-`)) ?? null;
}

/** Prefixes written by builds that used ISO 3166-1 alpha-3 country codes */
const LEGACY_PREFIXES: Record<string, StationCountry> = {
  fra: 'fr',
  esp: 'es',
  and: 'ad',
  prt: 'pt',
};

/**
 * Ids used to be stored differently: French ids were bare (the raw `id` of
 * the gouv dataset, or a « lat,lng » fallback — both start with a digit), and
 * every country then carried a 3-letter prefix (`fra-`, `esp-`, `and-`,
 * `prt-`). Persisted favorites and bookmarked /station/<id> URLs still carry
 * those shapes: map them onto the 2-letter scheme so they keep matching the
 * stations we load today.
 */
export function normalizeStationId(id: string): string {
  for (const [legacy, country] of Object.entries(LEGACY_PREFIXES)) {
    if (id.startsWith(`${legacy}-`)) return `${country}${id.slice(legacy.length)}`;
  }
  if (stationCountry(id) || !/^\d/.test(id)) return id;
  return `fr-${id}`;
}
