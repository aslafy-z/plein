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
/**
 * Normalized, filterable service tags (raw services kept for the detail
 * screen).
 *
 * `adBlue` is the one tag no source can be assumed to answer: Spain and
 * Andorra publish the product on sale, France and Portugal publish nothing at
 * all. Its absence therefore means « not sold » on one half of the coverage
 * and « never asked » on the other, which is why the filter reads it through
 * `answersAdBlue` (state/store) instead of a bare `tags.includes`.
 */
export type ServiceTag = 'open24h' | 'carWash' | 'shop' | 'airPump' | 'additives' | 'adBlue';
export const SERVICE_TAGS: ServiceTag[] = [
  'open24h',
  'carWash',
  'shop',
  'airPump',
  'additives',
  'adBlue',
];

/**
 * Extra products a source may list beyond the six graded fuels. The Spanish
 * flux carries a dozen of them, the Portuguese one its « especial »
 * (additivated) grades; providers emit these ids and the catalog supplies the
 * labels, so nothing translated leaks out of the parse layer.
 */
export type ExtraProductId =
  | 'dieselPremium'
  | 'petrolPremium'
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
  'petrolPremium',
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
  /**
   * Price of an extra product, when the source publishes one. The Spanish and
   * Andorran fluxes price every product they list (AdBlue included) while the
   * French and Portuguese ones only ever name theirs, so this stays sparse and
   * a chip without an entry means « on sale, price unknown ».
   */
  extraPrices?: Partial<Record<ExtraProductId, FuelPrice>>;
  /** true when on a motorway (gouv `pop === 'A'`) */
  highway: boolean;
  /** Opening hours when the source provides them (undefined = unknown) */
  hours?: StationHours;
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

/**
 * What a geocoder result denotes, normalized across the three national
 * geocoders. Suggestions are ranked by this (see `geocodeRank.ts`): someone
 * looking for cheap fuel means the town far more often than the street of the
 * same name three départements away.
 */
export type PlaceKind = 'locality' | 'street' | 'address' | 'other';

export interface GeocodeResult {
  label: string; // "Bordeaux centre"
  sublabel: string; // "Gironde" — as the source spells it, empty when it has none
  point: GeoPoint;
  /**
   * Country to name in front of `sublabel`. The French and Spanish sources say
   * where a place is themselves (a département, a province) — proper nouns no
   * locale translates. The Andorran one returns the parish alone and the
   * Portuguese one an OSM district, so the country is the app's own word and
   * belongs to the catalog.
   */
  country?: 'and' | 'prt';
  kind: PlaceKind;
}

export interface GeocodeSearchOptions {
  /**
   * Suggestions known SO FAR, published each time a source lands. « Automatique »
   * queries four national geocoders at once and one of them can be seconds
   * behind the others: the list fills in as they answer instead of waiting for
   * the slowest. The promise still resolves with the complete merge, so a view
   * can keep its spinner up until every source has concluded.
   */
  onPartial?(results: GeocodeResult[]): void;
}

export interface GeocodeProvider {
  search(query: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]>;
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
export type DataSourceId = 'auto' | 'fra' | 'esp' | 'and' | 'prt' | 'demo';

export interface ProviderBundle {
  stations: StationsProvider;
  geocode: GeocodeProvider;
  route: RouteProvider;
}
