// The persisted settings blob (`plein.settings.v1`) and its migrations.
//
// It lives outside the store so the locale strategy (lib/locale.ts) can read
// and write the very same blob without importing React: Paraglide then has no
// storage key of its own, and « what the app thinks the locale is » can never
// drift from « what Paraglide thinks it is ».
import type { GeoPoint } from '../lib/geo';
import type { DataSourceId, FuelId, GeocodeResult, ServiceTag, VehicleId } from '../data/types';
import { SERVICE_TAGS } from '../data/types';

const LS_KEY = 'plein.settings.v1';

/** Web maps site used by « Go there » on desktop (mobile opens the native GPS app) */
export type MapsSiteId = 'google' | 'waze' | 'apple' | 'osm';

export interface FavoriteStation {
  id: string;
  name: string;
  init: string;
  city?: string;
  lat: number;
  lng: number;
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
  mapsSite: MapsSiteId;
  /** Explicit language choice — absent means « follow the browser » */
  locale: string;
  /** Explicit theme choice — absent means « follow the browser » (validated
      on the way out by lib/colorScheme.ts, like `locale` by lib/locale.ts) */
  theme: string;
  /** Last position the app was centered on — restored on reload so the
      station cache hits instantly instead of flashing Toulouse/demo data */
  lastPos: GeoPoint;
  /** true when geolocation succeeded before — on reload the first stations
      fetch waits for the fresh fix instead of loading the stale area twice */
  geoGranted: boolean;
  installDismissed: boolean;
  /** Places looked up and picked — the map's search and the route fields
      share this one history */
  searchHistory: SearchedPlace[];
  /** Pinned stations — snapshot so they render even out of the loaded area */
  favorites: FavoriteStation[];
  /** Selected brand groups in the filters (empty/absent = every brand) */
  brandSel: string[];
  /** Active service filters (empty/absent = no service required) */
  serviceTags: ServiceTag[];
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

// Country codes used to be ISO 3166-1 alpha-3. The source choice and the
// geocoder country tag on history entries are both persisted, so a blob from
// that generation is mapped onto the 2-letter scheme on the way in — otherwise
// an explicit source choice would silently fall back to « Automatic » and a
// history row would lose its country line.
const LEGACY_SOURCES: Record<string, DataSourceId> = {
  fra: 'fr',
  esp: 'es',
  and: 'ad',
  prt: 'pt',
};

const LEGACY_PLACE_COUNTRIES: Record<string, 'ad' | 'pt'> = { and: 'ad', prt: 'pt' };

/** Canonical fuel id for a value coming from storage or a shared link */
export function migrateFuelId(raw: unknown): FuelId | null {
  if (typeof raw !== 'string') return null;
  const mapped = LEGACY_FUELS[raw] ?? raw;
  return (['diesel', 'e10', 'unleaded98', 'unleaded95', 'e85', 'lpg'] as string[]).includes(mapped)
    ? (mapped as FuelId)
    : null;
}

/** Canonical vehicle id for a value coming from storage or a shared link */
export function migrateVehicleId(raw: unknown): VehicleId | null {
  if (typeof raw !== 'string') return null;
  const mapped = LEGACY_VEHICLES[raw] ?? raw;
  return mapped === 'car' || mapped === 'motorcycle' ? (mapped as VehicleId) : null;
}

/**
 * Service filters coming from storage. The vocabulary grows (AdBlue joined it)
 * and a blob may have been written by another build or hand-edited, so an id
 * this build doesn't know is dropped: an unknown tag no station carries would
 * silently empty the map.
 */
function migrateServiceTags(raw: unknown): ServiceTag[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((t): t is ServiceTag => SERVICE_TAGS.includes(t as ServiceTag));
}

/** One entry of the retired « Recent » trip history — folded into
    `searchHistory` on the way in (a place driven to is a place looked up) */
interface LegacyRecentPlace {
  label?: unknown;
  sublabel?: unknown;
  point?: { lat?: unknown; lng?: unknown };
}

/** Blob shape written by builds that predate the English-identifier rename,
    that still carried the route's own `recents` store, or that persisted the
    retired notification toggles (they never drove anything) */
interface LegacySettings {
  conso?: number;
  bgloc?: boolean;
  alerts?: boolean;
  backgroundLocation?: boolean;
  recents?: LegacyRecentPlace[];
}

/**
 * Fold the retired trip history into the search history. The entries already
 * are `{label, sublabel?, point}`; only `at` has to be invented, and 0 puts
 * them under every real search. Places the search history already knows —
 * both stores remembered the same trips — keep their real entry.
 */
export function foldRecentsIntoSearchHistory(
  recents: unknown,
  history: SearchedPlace[],
): SearchedPlace[] {
  if (!Array.isArray(recents)) return history;
  const known = new Set(history.map((p) => p.label));
  const folded: SearchedPlace[] = [];
  for (const r of recents as LegacyRecentPlace[]) {
    if (typeof r?.label !== 'string' || r.label === '') continue;
    const lat = r.point?.lat;
    const lng = r.point?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (known.has(r.label)) continue;
    known.add(r.label);
    folded.push({
      label: r.label,
      sublabel: typeof r.sublabel === 'string' ? r.sublabel : '',
      point: { lat, lng },
      kind: 'other',
      at: 0,
    });
  }
  return [...history, ...folded];
}

function migrate(raw: Partial<PersistedSettings> & LegacySettings): Partial<PersistedSettings> {
  const out: Partial<PersistedSettings> & LegacySettings = { ...raw };
  const fuel = migrateFuelId(out.fuel);
  if (fuel) out.fuel = fuel;
  else delete out.fuel;
  const vehicle = migrateVehicleId(out.vehicle);
  if (vehicle) out.vehicle = vehicle;
  else delete out.vehicle;
  const serviceTags = migrateServiceTags(out.serviceTags);
  if (serviceTags) out.serviceTags = serviceTags;
  else delete out.serviceTags;
  if (typeof out.sourceId === 'string' && LEGACY_SOURCES[out.sourceId]) {
    out.sourceId = LEGACY_SOURCES[out.sourceId];
  }
  if (Array.isArray(out.searchHistory)) {
    out.searchHistory = out.searchHistory.map((place) => {
      const country =
        typeof place?.country === 'string' ? LEGACY_PLACE_COUNTRIES[place.country] : undefined;
      return country ? { ...place, country } : place;
    });
  }
  if (out.consumption == null && typeof out.conso === 'number') out.consumption = out.conso;
  if (out.recents != null) {
    out.searchHistory = foldRecentsIntoSearchHistory(out.recents, out.searchHistory ?? []);
  }
  delete out.conso;
  delete out.bgloc;
  delete out.alerts;
  delete out.backgroundLocation;
  delete out.recents;
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
