// The persisted settings blob (`plein.settings.v1`) and its migrations.
//
// It lives outside the store so the locale strategy (lib/locale.ts) can read
// and write the very same blob without importing React: Paraglide then has no
// storage key of its own, and « what the app thinks the locale is » can never
// drift from « what Paraglide thinks it is ».
import type { GeoPoint } from '../lib/geo';
import type { DataSourceId, FuelId, GeocodeResult, VehicleId } from '../data/types';

const LS_KEY = 'plein.settings.v1';

/** Web maps site used by « Y aller » on desktop (mobile opens the native GPS app) */
export type MapsSiteId = 'google' | 'waze' | 'apple' | 'osm';

export interface FavoriteStation {
  id: string;
  name: string;
  init: string;
  city?: string;
  lat: number;
  lng: number;
}

/** One entry of the « Récents » history — a real trip, or a default suggestion */
export interface RecentPlace {
  label: string;
  /** Static sub label of a default suggestion (a département, a province…) */
  sublabel?: string;
  point: GeoPoint;
  /** Trip length, for entries recorded from a real route */
  distanceKm?: number;
  /** When the trip was made (epoch ms) */
  at?: number;
}

/**
 * One entry of the map search history — a place looked up in the place search
 * and picked. Stored exactly as the geocoder returned it, so the row reads the
 * same whether it comes back from here or from a fresh answer, and picking it
 * again moves the same search circle to the same point.
 */
export interface SearchedPlace extends GeocodeResult {
  /** When it was last picked (epoch ms) — the history reads most recent first */
  at: number;
}

export interface PersistedSettings {
  fuel: FuelId;
  vehicle: VehicleId;
  tank: number;
  consumption: number;
  avoidMotorway: boolean;
  avoidToll: boolean;
  startTankPct: number;
  radius: number;
  sourceId: DataSourceId;
  onboarded: boolean;
  alerts: boolean;
  mapsSite: MapsSiteId;
  /** Explicit language choice — absent means « follow the browser » */
  locale: string;
  /** Last position the app was centered on — restored on reload so the
      station cache hits instantly instead of flashing Toulouse/demo data */
  lastPos: GeoPoint;
  /** true when geolocation succeeded before — on reload the first stations
      fetch waits for the fresh fix instead of loading the stale area twice */
  geoGranted: boolean;
  installDismissed: boolean;
  backgroundLocation: boolean;
  recents: RecentPlace[];
  /** Places picked in the map's place search, most recent first */
  searchHistory: SearchedPlace[];
  /** Pinned stations — snapshot so they render even out of the loaded area */
  favorites: FavoriteStation[];
  /** Selected brand groups in the filters (empty/absent = every brand) */
  brandSel: string[];
  /** Armed by onboarding, spent the first time the map sheet can bounce to
      show it pulls up — absent for anyone who onboarded before the hint
      existed, so it only ever plays for newcomers */
  sheetHint: boolean;
}

// ── Migrations ───────────────────────────────────────────────────────────────
// Fuel ids and the vehicle profile used to be French words. They are persisted
// and they key the price records, so a blob written by an older build has to be
// translated on the way in — otherwise the app boots on a fuel no station sells.
const LEGACY_FUELS: Record<string, FuelId> = {
  gazole: 'diesel',
  sp95: 'unleaded95',
  sp98: 'unleaded98',
  gplc: 'lpg',
};

const LEGACY_VEHICLES: Record<string, VehicleId> = { moto: 'motorcycle' };

/** Canonical fuel id for a value coming from storage or a shared link */
export function migrateFuelId(raw: unknown): FuelId | null {
  if (typeof raw !== 'string') return null;
  const mapped = LEGACY_FUELS[raw] ?? raw;
  return (['diesel', 'e10', 'unleaded98', 'unleaded95', 'e85', 'lpg'] as string[]).includes(mapped)
    ? (mapped as FuelId)
    : null;
}

function migrateVehicleId(raw: unknown): VehicleId | null {
  if (typeof raw !== 'string') return null;
  const mapped = LEGACY_VEHICLES[raw] ?? raw;
  return mapped === 'car' || mapped === 'motorcycle' ? (mapped as VehicleId) : null;
}

/** Blob shape written by builds that predate the English-identifier rename */
interface LegacySettings {
  conso?: number;
  bgloc?: boolean;
  recents?: (RecentPlace & { sublabel?: string })[];
}

function migrate(raw: Partial<PersistedSettings> & LegacySettings): Partial<PersistedSettings> {
  const out: Partial<PersistedSettings> & LegacySettings = { ...raw };
  const fuel = migrateFuelId(out.fuel);
  if (fuel) out.fuel = fuel;
  else delete out.fuel;
  const vehicle = migrateVehicleId(out.vehicle);
  if (vehicle) out.vehicle = vehicle;
  else delete out.vehicle;
  if (out.consumption == null && typeof out.conso === 'number') out.consumption = out.conso;
  if (out.backgroundLocation == null && typeof out.bgloc === 'boolean') {
    out.backgroundLocation = out.bgloc;
  }
  delete out.conso;
  delete out.bgloc;
  return out;
}

export function loadPersisted(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? migrate(JSON.parse(raw) as Partial<PersistedSettings>) : {};
  } catch {
    return {};
  }
}

export function savePersisted(p: Partial<PersistedSettings>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...loadPersisted(), ...p }));
  } catch {
    /* private mode etc. — non-fatal */
  }
}
