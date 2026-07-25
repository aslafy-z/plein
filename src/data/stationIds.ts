// ── Station ids ──────────────────────────────────────────────────────────────
// Every station id carries the country that issued it — `fra-31000009`,
// `esp-1234`, `and-42`, `prt-67360` — so a mixed « Automatique » list stays
// attributable (source footer, SP95-for-E10 substitution) without asking the
// provider. Demo ids ('su', 'r-a62'…) are deliberately outside that scheme.

export type StationCountry = 'fra' | 'esp' | 'and' | 'prt';

const PREFIXES: StationCountry[] = ['fra', 'esp', 'and', 'prt'];

/** Country that issued the id, or null for ids outside the scheme (demo) */
export function stationCountry(id: string): StationCountry | null {
  return PREFIXES.find((c) => id.startsWith(`${c}-`)) ?? null;
}

/**
 * French ids used to be stored bare (the raw `id` of the gouv dataset, or a
 * « lat,lng » fallback — both start with a digit). Persisted favorites and
 * bookmarked /station/<id> URLs still carry that shape: map them onto the
 * prefixed scheme so they keep matching the stations we load today.
 */
export function normalizeStationId(id: string): string {
  if (stationCountry(id) || !/^\d/.test(id)) return id;
  return `fra-${id}`;
}
