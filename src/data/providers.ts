// Provider registry — resolves a DataSourceId to a memoized bundle of providers.
import type { DataSourceId, ProviderBundle } from './types';
import { FraStationsProvider } from './fra/FraStationsProvider';
import { BanGeocodeProvider } from './fra/BanGeocodeProvider';
import { RealRouteProvider } from './fra/OsrmRouteProvider';
import { EspStationsProvider } from './esp/EspStationsProvider';
import { CartoCiudadGeocodeProvider } from './esp/CartoCiudadGeocodeProvider';
import { AutoStationsProvider } from './auto/AutoProviders';
import { PhotonGeocodeProvider } from './eu/PhotonGeocodeProvider';
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
      // Photon alone: pan-European coverage with one ranking, no interleave
      geocode: new PhotonGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'fra') {
    return {
      stations: new FraStationsProvider(),
      geocode: new BanGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'esp') {
    return {
      stations: new EspStationsProvider(),
      geocode: new CartoCiudadGeocodeProvider(),
      // OSRM / Valhalla public servers cover Spain too
      route: new RealRouteProvider(),
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
