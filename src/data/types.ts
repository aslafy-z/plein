// Data contracts — every provider (real or demo) speaks these types.
import type { GeoPoint } from '../lib/geo';
import type { StationHours } from '../lib/hours';

// ── Fuels ────────────────────────────────────────────────────────────────────
export type FuelId = 'gazole' | 'e10' | 'sp98' | 'sp95' | 'e85' | 'gplc';

export const FUEL_LABELS: Record<FuelId, string> = {
  gazole: 'Gazole',
  e10: 'SP95-E10',
  sp98: 'SP98',
  sp95: 'SP95',
  e85: 'E85',
  gplc: 'GPLc',
};

/** The three quick-switch fuels (map chip cycle + list tabs) */
export const MAIN_FUELS: FuelId[] = ['gazole', 'e10', 'e85'];
/** Every selectable fuel (filter sheet + settings) */
export const ALL_FUELS: FuelId[] = ['gazole', 'e10', 'sp98', 'sp95', 'e85', 'gplc'];

// ── Stations ─────────────────────────────────────────────────────────────────
/** Brand category used by the « Distributeurs » filter */
export type BrandCat = 'gs' | 'ind' | 'pet' | 'unknown';

/** Normalized, filterable service tags (raw services kept for the detail screen) */
export type ServiceTag = '24/24' | 'Lavage' | 'Boutique' | 'Gonflage' | 'Additifs';
export const SERVICE_TAGS: ServiceTag[] = ['24/24', 'Lavage', 'Boutique', 'Gonflage', 'Additifs'];

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
  cat: BrandCat;
  lat: number;
  lng: number;
  address: string;
  city: string;
  cp?: string;
  prices: Partial<Record<FuelId, FuelPrice>>;
  /** Normalized filterable tags */
  tags: ServiceTag[];
  /** Raw service labels for the detail screen */
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
  /** km from the user's position (road distance when known, crow-flies otherwise) */
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
  /** Human label shown in Réglages, e.g. "prix-carburants.gouv.fr" */
  label: string;
  /** Sub label, e.g. "temps réel · mis à jour toutes les 10 min" */
  sublabel: string;
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
  sublabel: string; // "Gironde"
  point: GeoPoint;
}

export interface GeocodeProvider {
  search(query: string): Promise<GeocodeResult[]>;
}

export interface Route {
  distanceKm: number;
  durationMin: number;
  polyline: GeoPoint[];
}

export type VehicleId = 'car' | 'moto';

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
