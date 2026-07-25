// Data contracts — every provider (real or demo) speaks these types.
import type { GeoPoint } from '../lib/geo';
import type { StationHours } from '../lib/hours';

// ── Fuels ────────────────────────────────────────────────────────────────────
// Ids are English technical symbols — they are persisted, put in shared links
// and used as record keys. `e10` / `e85` keep their EN 228 / EN 15293 grade
// codes. The user-facing labels live in the message catalog (lib/labels.ts).
export type FuelId = 'diesel' | 'e10' | 'unleaded98' | 'unleaded95' | 'e85' | 'lpg';

/** The three quick-switch fuels (map chip cycle + list tabs) */
export const MAIN_FUELS: FuelId[] = ['diesel', 'e10', 'e85'];
/** Every selectable fuel (filter sheet + settings) */
export const ALL_FUELS: FuelId[] = ['diesel', 'e10', 'unleaded98', 'unleaded95', 'e85', 'lpg'];

// ── Stations ─────────────────────────────────────────────────────────────────
/** Normalized, filterable service tags (raw services kept for the detail screen) */
export type ServiceTag = 'open24h' | 'carWash' | 'shop' | 'airPump' | 'additives';
export const SERVICE_TAGS: ServiceTag[] = ['open24h', 'carWash', 'shop', 'airPump', 'additives'];

/**
 * Extra products a source may list beyond the six graded fuels. The Spanish
 * flux carries a dozen of them; providers emit these ids and the catalog
 * supplies the labels, so nothing translated leaks out of the parse layer.
 */
export type ExtraProductId =
  | 'dieselPremium'
  | 'agriculturalDiesel'
  | 'adBlue'
  | 'cng'
  | 'lng'
  | 'bioCng'
  | 'bioLng'
  | 'hydrogen'
  | 'renewableDiesel'
  | 'renewablePetrol'
  | 'biodiesel'
  | 'bioethanol'
  | 'heatingOilDelivered'
  | 'heatingOilOnSite';

export const EXTRA_PRODUCT_IDS: ExtraProductId[] = [
  'dieselPremium',
  'agriculturalDiesel',
  'adBlue',
  'cng',
  'lng',
  'bioCng',
  'bioLng',
  'hydrogen',
  'renewableDiesel',
  'renewablePetrol',
  'biodiesel',
  'bioethanol',
  'heatingOilDelivered',
  'heatingOilOnSite',
];

export interface FuelPrice {
  value: number; // €/L
  updatedAt?: string; // ISO timestamp
}

export interface Station {
  id: string;
  /** Display name, e.g. "Station U · Croix-Blanche" or "Station · Roanne" (gouv flux has no names) */
  name: string;
  /** Short initials for the avatar, e.g. "SU" */
  init: string;
  brand?: string; // "Système U", "TotalEnergies"… undefined when the source doesn't know
  lat: number;
  lng: number;
  address: string;
  city: string;
  postalCode?: string;
  prices: Partial<Record<FuelId, FuelPrice>>;
  /** Normalized filterable tags */
  tags: ServiceTag[];
  /**
   * Services for the detail screen: an `ExtraProductId` when the source names
   * a known product, raw upstream text otherwise (the gouv flux writes free
   * text nobody can translate).
   */
  services: string[];
  /** true when on a motorway (gouv `pop === 'A'`) */
  highway: boolean;
  /** Opening hours when the source provides them (undefined = unknown) */
  hours?: StationHours;
  /** community confirmations (demo source only) */
  confirmations?: number;
}

/** A station enriched with position-relative info */
export interface NearbyStation extends Station {
  /** road km from the user's position (measured when known, estimated from crow-flies otherwise) */
  distKm: number;
  /** km from the search area center (drives the radius filter) */
  searchKm: number;
  driveMin: number;
}

/** A station enriched with route-relative info */
export interface RouteStation extends Station {
  kmAlong: number; // km from departure along the route
  detourMin: number; // extra minutes to reach it and come back
}

// ── Providers ────────────────────────────────────────────────────────────────
export interface SourceCapabilities {
  /** Does this source know station brands? (gouv flux does not) */
  brands: boolean;
}

export interface StationsFetchOptions {
  /** Background refresh behind an already-painted cache: hint the browser to
   * schedule the requests behind user-visible work (fetchpriority low). */
  lowPriority?: boolean;
}

export interface StationsProvider {
  readonly id: DataSourceId;
  readonly capabilities: SourceCapabilities;
  /** Stations within radiusKm of a point (any fuel). */
  getStationsNear(center: GeoPoint, radiusKm: number, opts?: StationsFetchOptions): Promise<Station[]>;
  /** Stations within corridorKm of a route polyline. */
  getStationsAlong(polyline: GeoPoint[], corridorKm: number): Promise<Station[]>;
}

export interface GeocodeResult {
  label: string; // "Bordeaux centre"
  sublabel: string; // "Gironde" — as the source spells it, empty when it has none
  point: GeoPoint;
  /**
   * Country to name in front of `sublabel`. The French and Spanish sources say
   * where a place is themselves (a département, a province) — proper nouns no
   * locale translates. The Andorran one returns the parish alone, so the
   * country is the app's own word and belongs to the catalog.
   */
  country?: 'and';
}

export interface GeocodeProvider {
  search(query: string): Promise<GeocodeResult[]>;
}

export interface Route {
  distanceKm: number;
  durationMin: number;
  polyline: GeoPoint[];
}

export type VehicleId = 'car' | 'motorcycle';

export interface RouteOptions {
  avoidMotorway?: boolean;
  avoidToll?: boolean;
  vehicle?: VehicleId;
}

/** Road distance & drive time to one target of a reach matrix */
export interface ReachInfo {
  distanceKm: number;
  durationMin: number;
}

export interface RouteProvider {
  getRoute(from: GeoPoint, to: GeoPoint, options?: RouteOptions): Promise<Route>;
  /**
   * Road distance/time from one origin to many targets in a single matrix
   * call. `null` per target when unroutable. Optional — sources without a
   * routing backend (demo) keep crow-flies distances.
   */
  getReachMatrix?(from: GeoPoint, targets: GeoPoint[]): Promise<Array<ReachInfo | null>>;
}

// ── Source selection ─────────────────────────────────────────────────────────
export type DataSourceId = 'auto' | 'fra' | 'esp' | 'and' | 'demo';

export interface ProviderBundle {
  stations: StationsProvider;
  geocode: GeocodeProvider;
  route: RouteProvider;
}
