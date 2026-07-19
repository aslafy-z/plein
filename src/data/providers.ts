// Provider registry — resolves a DataSourceId to a memoized bundle of providers.
import type { DataSourceId, ProviderBundle } from './types';
import { FraStationsProvider } from './fra/FraStationsProvider';
import { BanGeocodeProvider } from './fra/BanGeocodeProvider';
import { RealRouteProvider } from './fra/OsrmRouteProvider';
import { EspStationsProvider } from './esp/EspStationsProvider';
import { CartoCiudadGeocodeProvider } from './esp/CartoCiudadGeocodeProvider';
import { AutoGeocodeProvider, AutoStationsProvider } from './auto/AutoProviders';
import { IrveChargeProvider } from './irve/IrveChargeProvider';
import {
  DemoChargeProvider,
  DemoGeocodeProvider,
  DemoRouteProvider,
  DemoStationsProvider,
} from './demo/DemoProviders';

const cache = new Map<DataSourceId, ProviderBundle>();

function createBundle(id: DataSourceId): ProviderBundle {
  // Charge stations: the IRVE register is France-only for now, so every real
  // source shares the same provider — an 'esp'/'auto' map away from France
  // simply shows no bornes (the geo query returns nothing there).
  if (id === 'auto') {
    return {
      stations: new AutoStationsProvider(),
      charge: new IrveChargeProvider(),
      geocode: new AutoGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'fra') {
    return {
      stations: new FraStationsProvider(),
      charge: new IrveChargeProvider(),
      geocode: new BanGeocodeProvider(),
      route: new RealRouteProvider(),
    };
  }
  if (id === 'esp') {
    return {
      stations: new EspStationsProvider(),
      charge: new IrveChargeProvider(),
      geocode: new CartoCiudadGeocodeProvider(),
      // OSRM / Valhalla public servers cover Spain too
      route: new RealRouteProvider(),
    };
  }
  return {
    stations: new DemoStationsProvider(),
    charge: new DemoChargeProvider(),
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
