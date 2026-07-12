// Provider registry — resolves a DataSourceId to a memoized bundle of providers.
import type { DataSourceId, ProviderBundle } from './types';
import { GouvStationsProvider } from './gouv/GouvStationsProvider';
import { BanGeocodeProvider } from './gouv/BanGeocodeProvider';
import { OsrmRouteProvider } from './gouv/OsrmRouteProvider';
import {
  DemoGeocodeProvider,
  DemoRouteProvider,
  DemoStationsProvider,
} from './demo/DemoProviders';

const cache = new Map<DataSourceId, ProviderBundle>();

function createBundle(id: DataSourceId): ProviderBundle {
  if (id === 'gouv') {
    return {
      stations: new GouvStationsProvider(),
      geocode: new BanGeocodeProvider(),
      route: new OsrmRouteProvider(),
    };
  }
  return {
    stations: new DemoStationsProvider(),
    geocode: new DemoGeocodeProvider(),
    route: new DemoRouteProvider(),
  };
}

/** Memoized singleton bundle for a data source. */
export function getProviders(id: DataSourceId): ProviderBundle {
  let bundle = cache.get(id);
  if (!bundle) {
    bundle = createBundle(id);
    cache.set(id, bundle);
  }
  return bundle;
}
