// Session memo in front of a geocoder.
//
// Suggestions are refetched on every keystroke past the minimum length, so
// backspacing one letter used to re-query the national geocoders for a string
// they answered a moment earlier. An address is stable for minutes, not across
// a reload — this is a memory tier, nothing here is ever persisted.
import { TtlLru } from '../lib/lru';
import type { GeocodeProvider, GeocodeResult, GeocodeSearchOptions } from './types';

const MAX_ENTRIES = 50;
const TTL_MS = 10 * 60_000;

/**
 * Memoizes a geocoder's answers. Failures are never cached — a timeout must
 * not pin an empty list on a query for ten minutes — and a hit still calls
 * `onPartial`, so a caller that paints from it (« Automatic » fills its list
 * as sources land) sees the same sequence as on a miss.
 */
export function withGeocodeMemo(inner: GeocodeProvider): GeocodeProvider {
  const memo = new TtlLru<GeocodeResult[]>(MAX_ENTRIES, TTL_MS);
  return {
    async search(query: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]> {
      const key = query.trim().toLowerCase();
      const hit = memo.get(key);
      if (hit) {
        opts?.onPartial?.(hit);
        return hit;
      }
      const results = await inner.search(query, opts);
      memo.set(key, results);
      return results;
    },
  };
}
