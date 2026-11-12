import { describe, it, expect } from 'vitest';
import { withGeocodeMemo } from './geocodeMemo';
import type { GeocodeProvider, GeocodeResult, GeocodeSearchOptions } from './types';

function result(label: string): GeocodeResult {
  return { label, sublabel: 'Haute-Garonne', point: { lat: 43.6, lng: 1.44 }, kind: 'locality' };
}

/** Counts what actually reaches the network side of the memo */
function countingProvider(
  answer: (query: string) => Promise<GeocodeResult[]>,
): GeocodeProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    search: async (query: string, opts?: GeocodeSearchOptions) => {
      calls.push(query);
      const results = await answer(query);
      opts?.onPartial?.(results);
      return results;
    },
  };
}

describe('withGeocodeMemo', () => {
  it('answers a repeated query without querying the source again', async () => {
    const inner = countingProvider(async () => [result('Toulouse')]);
    const memo = withGeocodeMemo(inner);

    expect((await memo.search('toulouse')).map((r) => r.label)).toEqual(['Toulouse']);
    expect((await memo.search('toulouse')).map((r) => r.label)).toEqual(['Toulouse']);

    expect(inner.calls).toEqual(['toulouse']);
  });

  it('treats case and surrounding spaces as the same query', async () => {
    const inner = countingProvider(async () => [result('Toulouse')]);
    const memo = withGeocodeMemo(inner);

    await memo.search('Toulouse');
    await memo.search('  toulouse ');

    expect(inner.calls).toEqual(['Toulouse']);
  });

  it('replays onPartial on a hit, so a caller paints the same either way', async () => {
    const inner = countingProvider(async () => [result('Toulouse')]);
    const memo = withGeocodeMemo(inner);
    const painted: string[][] = [];
    const opts = { onPartial: (r: GeocodeResult[]) => painted.push(r.map((x) => x.label)) };

    await memo.search('toulouse', opts);
    await memo.search('toulouse', opts);

    expect(painted).toEqual([['Toulouse'], ['Toulouse']]);
  });

  it('never remembers a failure', async () => {
    let fail = true;
    const inner = countingProvider(async (query) => {
      if (fail) throw new Error(`timeout on ${query}`);
      return [result('Toulouse')];
    });
    const memo = withGeocodeMemo(inner);

    await expect(memo.search('toulouse')).rejects.toThrow('timeout');
    fail = false;

    expect((await memo.search('toulouse')).map((r) => r.label)).toEqual(['Toulouse']);
    expect(inner.calls).toEqual(['toulouse', 'toulouse']);
  });

  it('returns an incomplete answer without remembering it', async () => {
    // « Automatic » with one source down: the survivors' merge is the best
    // list available, not the answer to the query.
    let spainDown = true;
    const calls: string[] = [];
    const inner: GeocodeProvider = {
      search: async (query, opts) => {
        calls.push(query);
        if (spainDown) {
          opts?.onIncomplete?.();
          return [result('Toulouse')];
        }
        return [result('Toulouse'), result('Girona')];
      },
    };
    const memo = withGeocodeMemo(inner);
    let flagged = 0;

    const first = await memo.search('to', { onIncomplete: () => flagged++ });
    expect(first.map((r) => r.label)).toEqual(['Toulouse']);
    expect(flagged).toBe(1);

    spainDown = false;
    expect((await memo.search('to')).map((r) => r.label)).toEqual(['Toulouse', 'Girona']);
    // The complete answer is the one that sticks.
    expect((await memo.search('to')).map((r) => r.label)).toEqual(['Toulouse', 'Girona']);
    expect(calls).toEqual(['to', 'to']);
  });

  it('asks again when the map looks somewhere else: the home country reorders the list', async () => {
    const inner = countingProvider(async (q) => [result(q)]);
    const memo = withGeocodeMemo(inner);
    await memo.search('valen', { near: { lat: 43.6, lng: 1.44 } });
    await memo.search('valen', { near: { lat: 43.61, lng: 1.42 } }); // same spot, to ~11 km
    await memo.search('valen', { near: { lat: 38.72, lng: -9.14 } });
    expect(inner.calls).toHaveLength(2);
  });
});
