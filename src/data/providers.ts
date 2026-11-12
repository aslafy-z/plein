// Provider registry — resolves a DataSourceId to a memoized bundle of providers.
import { withGeocodeMemo } from './geocodeMemo';
import { isForcedOffline } from '../lib/connectivity';
import type { DataSourceId, GeocodeProvider, ProviderBundle } from './types';
import { FrStationsProvider } from './fr/FrStationsProvider';
import { RealRouteProvider } from './fr/OsrmRouteProvider';
import { EsStationsProvider } from './es/EsStationsProvider';
import { AdStationsProvider } from './ad/AdStationsProvider';
import { PtStationsProvider } from './pt/PtStationsProvider';
import { PhotonGeocodeProvider } from './pt/PhotonGeocodeProvider';
import {
  AutoGeocodeProvider,
  AutoStationsProvider,
  FrGeocodeProvider,
  adGeocodeProvider,
  esGeocodeProvider,
} from './auto/AutoProviders';
import {
  DemoGeocodeProvider,
  DemoRouteProvider,
  DemoStationsProvider,
} from './demo/DemoProviders';

const cache = new Map<DataSourceId, ProviderBundle>();

function createBundle(id: DataSourceId): ProviderBundle {
  if (id === 'auto') {
    return {
      stations: new AutoStationsProvider(),
      geocode: new AutoGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'fr') {
    return {
      stations: new FrStationsProvider(),
      geocode: new FrGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'es') {
    return {
      stations: new EsStationsProvider(),
      geocode: esGeocodeProvider(),
      // OSRM / Valhalla public servers cover Spain too
      route: new RealRouteProvider(),
    };
  }
  if (id === 'ad') {
    return {
      stations: new AdStationsProvider(),
      geocode: adGeocodeProvider(),
      // OSRM / Valhalla public servers cover Andorra too (OSM-based)
      route: new RealRouteProvider(),
    };
  }
  if (id === 'pt') {
    return {
      stations: new PtStationsProvider(),
      geocode: new PhotonGeocodeProvider(),
      // OSRM / Valhalla public servers cover Portugal too
      route: new RealRouteProvider(),
    };
  }
  return {
    stations: new DemoStationsProvider(),
    geocode: new DemoGeocodeProvider(),
    route: new DemoRouteProvider(),
  };
}

/**
 * « Force offline mode » in front of a geocoder: the network is never asked
 * while the switch holds. It sits INSIDE the memo, so a query answered
 * earlier in the session still comes back — the same policy the station cache
 * follows offline, and the failure a caller sees is the one a real offline
 * device produces (PlaceField turns it into its « no result » state).
 */
function withOfflineGate(inner: GeocodeProvider): GeocodeProvider {
  return {
    search(query, opts) {
      if (isForcedOffline()) return Promise.reject(new Error('forced offline'));
      return inner.search(query, opts);
    },
  };
}

/** Memoized singleton bundle for a data source. */
export function getProviders(id: DataSourceId): ProviderBundle {
  let bundle = cache.get(id);
  if (!bundle) {
    const built = createBundle(id);
    // The demo source resolves its places locally — nothing to take offline
    const geocode = id === 'demo' ? built.geocode : withOfflineGate(built.geocode);
    bundle = { ...built, geocode: withGeocodeMemo(geocode) };
    cache.set(id, bundle);
  }
  return bundle;
}
