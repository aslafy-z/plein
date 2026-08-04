// Provider registry — resolves a DataSourceId to a memoized bundle of providers.
import { withGeocodeMemo } from './geocodeMemo';
import type { DataSourceId, ProviderBundle } from './types';
import { FrStationsProvider } from './fr/FrStationsProvider';
import { BanGeocodeProvider } from './fr/BanGeocodeProvider';
import { RealRouteProvider } from './fr/OsrmRouteProvider';
import { EsStationsProvider } from './es/EsStationsProvider';
import { CartoCiudadGeocodeProvider } from './es/CartoCiudadGeocodeProvider';
import { AdStationsProvider } from './ad/AdStationsProvider';
import { AdGeocodeProvider } from './ad/AdGeocodeProvider';
import { PtStationsProvider } from './pt/PtStationsProvider';
import { PhotonGeocodeProvider } from './pt/PhotonGeocodeProvider';
import { AutoGeocodeProvider, AutoStationsProvider } from './auto/AutoProviders';
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
      geocode: new BanGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'es') {
    return {
      stations: new EsStationsProvider(),
      geocode: new CartoCiudadGeocodeProvider(),
      // OSRM / Valhalla public servers cover Spain too
      route: new RealRouteProvider(),
    };
  }
  if (id === 'ad') {
    return {
      stations: new AdStationsProvider(),
      geocode: new AdGeocodeProvider(),
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

/** Memoized singleton bundle for a data source. */
export function getProviders(id: DataSourceId): ProviderBundle {
  let bundle = cache.get(id);
  if (!bundle) {
    const built = createBundle(id);
    bundle = { ...built, geocode: withGeocodeMemo(built.geocode) };
    cache.set(id, bundle);
  }
  return bundle;
}
