// A second geocoder behind a national one.
//
// The national services are the better source — official data, the country's
// own way of naming a place — and they have outages: the Spanish one goes
// through spells where it only answers after its timeout, and a failure of
// its `find` step takes the whole search with it. When the primary fails
// whole, the backup answers in its place, and that answer is a complete one:
// the caller is told nothing is missing. The backup is never asked while the
// primary answers, a slow answer included — asking both would double the load
// on a public instance to save a wait the spinner already explains.
import type { GeocodeProvider, GeocodeResult, GeocodeSearchOptions } from './types';

export class BackedUpGeocodeProvider implements GeocodeProvider {
  constructor(
    private readonly primary: GeocodeProvider,
    private readonly backup: GeocodeProvider,
  ) {}

  search(query: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]> {
    return this.primary.search(query, opts).catch(() => this.backup.search(query));
  }
}
