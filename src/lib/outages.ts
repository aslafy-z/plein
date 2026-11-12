// Fuel outages (« ruptures ») — pure answers the views turn into sentences.
//
// Only the French flux publishes outages, and a fuel in outage never carries
// a price there: on its own, the app would read an empty pump as « not sold
// here ». These helpers keep the distinction, and also recognize a station
// that has served nothing for a week: around Toulouse on 2026-11-07, five
// stations had every fuel « temporarily » out since the same minute of
// 2026-09-18 — closed in all but name, and not a shortage worth counting.
import type { FuelId, FuelOutage, Station } from '../data/types';

/** A station selling nothing, every outage older than this, is dormant */
export const DORMANT_MS = 7 * 24 * 3600_000;

type OutageFields = Pick<Station, 'prices' | 'outages'>;

/** The outage of a fuel at a station — null when it is priced or none is known */
export function fuelOutage(s: OutageFields, fuel: FuelId): FuelOutage | null {
  if (s.prices[fuel] != null) return null;
  return s.outages?.[fuel] ?? null;
}

function sinceMs(o: FuelOutage | undefined): number | null {
  if (!o?.since) return null;
  const t = new Date(o.since).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * When a station that sells nothing at all ran out of its last fuel, if that
 * was more than `DORMANT_MS` ago — null for any station still serving, or
 * whose outages are recent or undated.
 */
export function dormantSince(s: OutageFields, now = Date.now()): number | null {
  if (Object.values(s.prices).some((p) => p != null)) return null;
  const outages = Object.values(s.outages ?? {});
  if (outages.length === 0) return null;
  let latest = -Infinity;
  for (const o of outages) {
    const t = sinceMs(o);
    if (t == null) return null;
    latest = Math.max(latest, t);
  }
  return now - latest > DORMANT_MS ? latest : null;
}

/** Is this fuel out of stock at a station that is still a live station? */
export function isLiveOutage(s: OutageFields, fuel: FuelId, now = Date.now()): boolean {
  return fuelOutage(s, fuel) != null && dormantSince(s, now) == null;
}

/**
 * How to date an outage: a clock time when it started today, a calendar day
 * otherwise, nothing when the source gave no start.
 */
export type OutageStart =
  | { kind: 'today'; at: number }
  | { kind: 'day'; at: number }
  | { kind: 'unknown' };

export function outageStart(o: FuelOutage, now = Date.now()): OutageStart {
  const t = sinceMs(o);
  if (t == null) return { kind: 'unknown' };
  const day = (ms: number) => new Date(ms).toDateString();
  return day(t) === day(now) ? { kind: 'today', at: t } : { kind: 'day', at: t };
}
