// App store — state, actions, async data loading, derived selectors.
// Single source of truth so map / list / detail / route never disagree.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
// Registers the locale strategy — imported first so nothing can reach a
// message function before Paraglide knows how to resolve the language.
import {
  applyLocale,
  currentLocale,
  explicitLocale,
  followBrowserLocale,
  syncDocumentLocale,
  type Locale,
} from '../lib/locale';
import { IS_ANDROID, IS_IOS } from '../lib/env';
import type { GeoPoint } from '../lib/geo';
import { m } from '../paraglide/messages.js';
import { haversineKm } from '../lib/geo';
import {
  ALL_FUELS,
  SERVICE_TAGS,
  type VehicleId,
  type DataSourceId,
  type FuelId,
  type FuelPrice,
  type GeocodeResult,
  type GeocodeSearchOptions,
  type NearbyStation,
  type ReachInfo,
  type Route,
  type RouteStation,
  type ServiceTag,
  type Station,
} from '../data/types';
import { getProviders } from '../data/providers';
import { fuelLabel } from '../lib/labels';
import { brandGroup } from '../lib/brandIcons';
import { CROW_ROAD_FACTOR, effectiveLiterPrice, usableRangeKm } from '../lib/fuelEconomics';
import {
  estimatePlanLegs,
  matrixPlanLegs,
  projectCorridor,
  selectRouteCandidates,
  type PlanLegs,
  type RouteCandidate,
} from '../lib/routeCandidates';
import {
  planRoute,
  type PlanQuality,
  type PlannedFuelStop,
  type RoutePlan,
} from '../lib/routeOptimizer';
import {
  loadPersisted,
  savePersisted,
  type FavoriteStation,
  type MapsSiteId,
  type PersistedSettings,
  type RecentPlace,
} from './persist';
import { mapUrlQuery, parseMapUrl } from '../lib/mapUrl';
import { mapViewShareData, stationShareData, type ShareData } from '../lib/share';
import { readStationsCache, writeStationsCache, STALE_MS } from '../data/stationsCache';
import { normalizeStationId, stationCountry, type StationCountry } from '../data/stationIds';
import {
  installReady,
  isStandalone,
  promptInstall as nativeInstallPrompt,
  subscribeInstall,
} from '../lib/installPrompt';

// ── Constants ────────────────────────────────────────────────────────────────
/** Toulouse Capitole — default position when geolocation is unavailable */
export const DEFAULT_POS: GeoPoint = { lat: 43.6047, lng: 1.4442 };
/** Recent-trip history kept in Réglages persistence */
const MAX_RECENTS = 4;
export const MAX_RADIUS_KM = 25;
/** Vehicle profile presets (tank L, consumption L/100 km, default fuel) — adjustable in Réglages */
export const VEHICLE_PRESETS: Record<
  VehicleId,
  { tank: number; consumption: number; fuel: FuelId }
> = {
  car: { tank: 50, consumption: 6.5, fuel: 'diesel' },
  motorcycle: { tank: 15, consumption: 5, fuel: 'e10' },
};
const DEFAULT_CONSUMPTION = VEHICLE_PRESETS.car.consumption;
/** Default departure tank level (%) — adjustable on the route setup */
const DEFAULT_START_TANK_PCT = 70;
/**
 * Points of one fuel-plan matrix call: origin + candidate stations +
 * destination. Providers may cap lower (travelMatrixMaxPoints); 32 keeps the
 * request small while covering ~30 stations, plenty for one corridor.
 */
const MATRIX_MAX_POINTS = 32;
// Shared fuel-economics constants live in lib/fuelEconomics — re-exported so
// existing imports (tests, screens) keep one canonical source.
export { CROW_ROAD_FACTOR, effectiveLiterPrice };
/**
 * Stations covered by one road-distance matrix call, nearest first. Public
 * OSRM caps table sizes, so a dense zone always holds more stations than one
 * call can measure; the rest fall back to the CROW_ROAD_FACTOR estimate,
 * which keeps them on the same scale as the measured ones.
 */
const ROAD_REACH_MAX = 60;
/** Min pause between two URL rewrites while the map view moves */
const MAP_URL_MIN_MS = 500;

export type Screen =
  | 'onboarding'
  | 'map'
  | 'favs'
  | 'routeSetup'
  | 'route'
  | 'settings'
  | 'detail';

export type RouteMode = 'balanced' | 'price' | 'detour';
export type SortMode = 'price' | 'distance';

export type { MapsSiteId, FavoriteStation, RecentPlace };
/** Web maps sites offered by « Y aller » on desktop, in display order */
export const MAPS_SITE_IDS: MapsSiteId[] = ['google', 'waze', 'apple', 'osm'];

/** Display name of a maps site — only Apple's differs across locales */
export function mapsSiteLabel(id: MapsSiteId): string {
  switch (id) {
    case 'waze':
      return m.maps_site_waze();
    case 'apple':
      return m.maps_site_apple();
    case 'osm':
      return m.maps_site_osm();
    default:
      return m.maps_site_google();
  }
}
function mapsSiteUrl(site: MapsSiteId, lat: number, lng: number): string {
  switch (site) {
    case 'waze':
      return `https://www.waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
    case 'apple':
      return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
    case 'osm':
      return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
}

interface StationsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: Station[];
  /** Source that actually served the data (after fallback) */
  activeSource: DataSourceId;
  /** true when the real source failed and demo data was substituted */
  fellBack: boolean;
  /** When the shown data was fetched from the source (cache or live) */
  fetchedAt?: number;
  /** true while cached data is shown and a background refresh is running */
  refreshing: boolean;
}

interface RouteState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  route: Route | null;
  stations: RouteStation[];
  fellBack: boolean;
  error?: string;
}

/**
 * One travel-matrix call per (route, candidate set): the road legs the
 * fuel-stop optimizer runs on. While it loads — or when it fails — the plan
 * runs on the geometric estimate and says so (`quality: 'estimated'`).
 */
export interface RouteMatrixState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Identity of the candidate set + endpoints the cells answer for */
  key: string | null;
  cells: Array<Array<ReachInfo | null>> | null;
}

/** Everything that identifies one matrix call — a changed key means refetch
    @internal exported for unit tests */
export function travelMatrixKey(
  source: DataSourceId,
  from: GeoPoint,
  to: GeoPoint,
  candidates: readonly RouteCandidate[],
  options: { avoidMotorway: boolean; avoidToll: boolean; vehicle: VehicleId },
): string {
  return [
    source,
    from.lat.toFixed(4),
    from.lng.toFixed(4),
    to.lat.toFixed(4),
    to.lng.toFixed(4),
    options.avoidMotorway ? 'm1' : 'm0',
    options.avoidToll ? 't1' : 't0',
    options.vehicle,
    ...candidates.map((c) => c.station.id),
  ].join('|');
}

/** Candidate stations of the current route plan — pure, shared by the matrix
    effect and the selectors so both always describe the same set. */
function planCandidatesFor(
  routeState: RouteState,
  fuel: FuelId,
  vehicle: { tank: number; consumption: number; startTankPct: number },
  plannedStops: Record<string, boolean>,
  matrixMaxPoints: number | undefined,
): RouteCandidate[] {
  const route = routeState.route;
  if (routeState.status !== 'ready' || !route) return [];
  const cap = Math.min(MATRIX_MAX_POINTS, matrixMaxPoints ?? MATRIX_MAX_POINTS) - 2;
  return selectRouteCandidates(route, routeState.stations, (s) => effectivePrice(s, fuel), {
    maxCandidates: cap,
    firstWindowKm: usableRangeKm((vehicle.tank * vehicle.startTankPct) / 100, vehicle.consumption),
    requiredIds: Object.keys(plannedStops).filter((id) => plannedStops[id]),
  });
}

// ── Persistence ──────────────────────────────────────────────────────────────
/**
 * Mirror one slice of state into the persisted blob whenever it changes.
 *
 * React treats `useState` updaters as pure and may run them more than once —
 * StrictMode does it deliberately, and the same guarantee is what lets React
 * discard and replay a render. So state that has to survive a reload but whose
 * next value is computed from the previous one persists here, from an effect,
 * instead of from inside the updater.
 *
 * The mount pass writes nothing: it would only echo back what we just loaded,
 * and it would materialise the storage key for someone who never touched a
 * setting (a `?fuel=` link, for instance, stays a one-off).
 */
function usePersisted<K extends keyof PersistedSettings>(key: K, value: PersistedSettings[K]) {
  const last = useRef(value);
  useEffect(() => {
    if (Object.is(last.current, value)) return;
    last.current = value;
    savePersisted({ [key]: value } as Partial<PersistedSettings>);
  }, [key, value]);
}

// ── Pure state updaters ──────────────────────────────────────────────────────
// Exported so they can be unit-tested for what the setters rely on: they
// compute the next value from the previous one and do nothing else, so running
// them twice is indistinguishable from running them once.

/** Star `s`, or unstar it when it is already pinned */
export function toggleFavoriteIn(
  prev: FavoriteStation[],
  s: FavoriteStation,
): FavoriteStation[] {
  return prev.some((f) => f.id === s.id) ? prev.filter((f) => f.id !== s.id) : [...prev, s];
}

/** Fuel that follows `cur` in the cycling order of the map's fuel chip */
export function nextFuelAfter(cur: FuelId): FuelId {
  return ALL_FUELS[(ALL_FUELS.indexOf(cur) + 1) % ALL_FUELS.length];
}

/** Select `label` in the brand filter, or deselect it when already selected */
export function toggleBrandIn(sel: string[], label: string): string[] {
  return sel.includes(label) ? sel.filter((b) => b !== label) : [...sel, label];
}

/**
 * Prepend a trip to the « Récents » history. Without real history yet, the
 * default suggestions are dropped rather than pushed down.
 */
export function pushRecentIn(
  prev: RecentPlace[],
  entry: RecentPlace,
  hasTripHistory: boolean,
): RecentPlace[] {
  const base = hasTripHistory ? prev : [];
  return [entry, ...base.filter((r) => r.label !== entry.label)].slice(0, MAX_RECENTS);
}

/**
 * Record a whole trip: a departure typed or picked by hand is a place the user
 * looked up, so it earns its « Récents » row just like the destination — only
 * « Ma position » doesn't, which is why the caller passes the endpoints it has.
 * `entries` are applied in order, so the LAST one ends up on top: pass the
 * departure first and the destination second.
 */
export function pushTripIn(
  prev: RecentPlace[],
  entries: RecentPlace[],
  hasTripHistory: boolean,
): RecentPlace[] {
  // Only the first push may drop the default suggestions — after it, the
  // history is real and the rest of the trip must not wipe it again.
  return entries.reduce(
    (acc, entry, i) => pushRecentIn(acc, entry, hasTripHistory || i > 0),
    prev,
  );
}

/**
 * Destination suggestions shown until the user has real trip history. The sub
 * label is a département name — a proper noun, not copy to translate.
 */
export const DEFAULT_RECENTS: RecentPlace[] = [
  { label: 'Toulouse', sublabel: 'Haute-Garonne', point: { lat: 43.6047, lng: 1.4442 } },
];

// ── Store shape ──────────────────────────────────────────────────────────────
export interface AppStore {
  // navigation
  screen: Screen;
  /** Screen the station detail was opened from (route context vs nearby context) */
  prevScreen: Screen;
  go(screen: Screen): void;
  back(): void;
  openStation(id: string): void;

  // fuel / filters
  fuel: FuelId;
  setFuel(f: FuelId): void;
  cycleFuel(): void;
  sort: SortMode;
  setSort(s: SortMode): void;
  radius: number;
  setRadius(r: number): void;
  /** Selected brand labels (persisted). Empty = every brand passes. */
  brandSel: string[];
  toggleBrand(label: string): void;
  serviceTags: Partial<Record<ServiceTag, boolean>>;
  toggleServiceTag(t: ServiceTag): void;
  filtersOpen: boolean;
  setFiltersOpen(open: boolean): void;
  resetFilters(): void;

  // stations around me
  userPos: GeoPoint;
  geoStatus: 'pending' | 'granted' | 'denied' | 'unavailable';
  /** true when a real position was known before (persisted across reloads) */
  hasKnownPos: boolean;
  requestGeolocation(): void;
  /** Center of the stations search (follows userPos until the user searches elsewhere on the map) */
  searchPos: GeoPoint;
  /** true when searchPos was moved away from the user's position */
  searchedAway: boolean;
  /** Name of the searched place (null when following the user / free pan) */
  searchLabel: string | null;
  setSearchArea(p: GeoPoint, label?: string): void;
  resetSearchToUser(): void;
  /** Station highlighted on the map & shown in the map bottom-sheet card */
  focusStationId: string | null;
  setFocusStation(id: string | null): void;
  /** Leaflet zoom mirrored in the URL (null until the map has settled) */
  mapZoom: number | null;
  setMapZoom(z: number): void;
  stations: StationsState;
  reloadStations(): void;
  /** Road distance & drive time per station id — stations absent from the
      map fall back to crow-flies distances everywhere they're displayed */
  roadReach: Record<string, ReachInfo>;

  // favorites (Favoris tab)
  favorites: FavoriteStation[];
  isFavorite(id: string): boolean;
  toggleFavorite(s: FavoriteStation): void;

  // route
  fromText: string;
  /** true while the departure field means « wherever I am » rather than a typed place */
  fromIsCurrentPosition: boolean;
  toText: string;
  fromPoint: GeoPoint | null;
  toPoint: GeoPoint | null;
  setFrom(text: string, point?: GeoPoint | null): void;
  /** Put the departure field back on the user's position */
  useCurrentPositionAsStart(): void;
  setTo(text: string, point?: GeoPoint | null): void;
  searchPlaces(q: string, opts?: GeocodeSearchOptions): Promise<GeocodeResult[]>;
  recents: RecentPlace[];
  /** false while `recents` still shows the default suggestions */
  hasTripHistory: boolean;
  routeReady: boolean;
  startRoute(): void;
  editRoute(): void;
  /** « Où allez-vous ? » → route setup with the destination field focused */
  openRouteSearch(): void;
  /** true while the destination field should grab focus (open the keyboard) */
  focusDestination: boolean;
  consumeFocusDestination(): void;
  routeMode: RouteMode;
  setRouteMode(m: RouteMode): void;
  avoidMotorway: boolean;
  avoidToll: boolean;
  setAvoidMotorway(v: boolean): void;
  setAvoidToll(v: boolean): void;
  /** Tank level at departure (%), drives the autonomy math */
  startTankPct: number;
  setStartTankPct(v: number): void;
  routeState: RouteState;
  /** Road matrix backing the route fuel-stop plan (one call per candidate set) */
  routeMatrix: RouteMatrixState;
  /** Stops the user picked for a multi-stop run, by station id */
  plannedStops: Record<string, boolean>;
  togglePlannedStop(id: string): void;

  // settings
  vehicle: VehicleId;
  /** Switch profile and apply its tank/consumption/fuel presets */
  setVehicle(v: VehicleId): void;
  tank: number;
  setTank(t: number): void;
  /** Average consumption, L/100 km — feeds autonomy + trip cost */
  consumption: number;
  setConsumption(v: number): void;
  alerts: boolean;
  setAlerts(v: boolean): void;
  backgroundLocation: boolean;
  setBackgroundLocation(v: boolean): void;
  sourceId: DataSourceId;
  setSourceId(s: DataSourceId): void;
  /** Maps website opened by « Y aller » on desktop */
  mapsSite: MapsSiteId;
  setMapsSite(s: MapsSiteId): void;
  /** Active language — null while the app follows the browser */
  locale: Locale;
  localeIsExplicit: boolean;
  setLocale(l: Locale | null): void;

  // detail
  detailId: string | null;

  // maps + toast
  toast: string | null;
  notify(msg: string): void;
  openInMaps(target: Station | RouteStation): void;
  openPlannedStopsInMaps(): void;
  shareStation(target: Station | RouteStation): void;
  /** Share the map as it stands — same link the address bar carries */
  shareMapView(): void;

  // PWA install
  installReady: boolean;
  installBannerVisible: boolean;
  promptInstall(): void;
  dismissInstallBanner(): void;

  // onboarding
  finishOnboarding(withGeoloc: boolean): void;
  /** true until the map sheet has played its « you can pull me up » bounce */
  sheetHint: boolean;
  consumeSheetHint(): void;
}

// ── URL routing (tabs survive a refresh) ────────────────────────────────────
function pathFor(screen: Screen, detailId: string | null): string {
  switch (screen) {
    case 'favs':
      return '/favorites';
    case 'routeSetup':
    case 'route':
      return '/route';
    case 'settings':
      return '/settings';
    case 'detail':
      return detailId ? `/station/${encodeURIComponent(detailId)}` : '/';
    default:
      return '/';
  }
}

function navFromPath(path: string): { screen: Screen; detailId: string | null } {
  // /list is the pre-Favoris URL — keep old bookmarks working
  if (path.startsWith('/favorites') || path.startsWith('/list'))
    return { screen: 'favs', detailId: null };
  if (path.startsWith('/route')) return { screen: 'routeSetup', detailId: null };
  if (path.startsWith('/settings')) return { screen: 'settings', detailId: null };
  if (path.startsWith('/station/')) {
    // Bookmarks predating the `fra-` prefix still carry a bare French id
    const id = normalizeStationId(decodeURIComponent(path.slice('/station/'.length)));
    return { screen: 'detail', detailId: id };
  }
  return { screen: 'map', detailId: null };
}

/** What the app stores in `history.state` for each of its own entries */
type NavHistoryState = {
  plein?: boolean;
  screen?: Screen;
  detailId?: string | null;
  filtersOpen?: boolean;
  /** 0 = the entry the app was opened on (nothing of ours to pop below it) */
  idx?: number;
};

const Ctx = createContext<AppStore | null>(null);

// ── Provider component ───────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useRef(loadPersisted()).current;

  const initialNav = navFromPath(window.location.pathname);
  // A link followed by someone who hasn't onboarded yet: the walkthrough comes
  // first, so the destination is parked here and restored when it ends.
  const pendingNav = useRef(persisted.onboarded ? null : initialNav);
  // A shared map link (`/?ll=…&z=…&f=…&r=…`) wins over the persisted settings:
  // whoever opens it must see the view that was shared, not their own.
  const initialMap = useRef(parseMapUrl(window.location.search)).current;
  const [screen, setScreen] = useState<Screen>(
    persisted.onboarded ? initialNav.screen : 'onboarding',
  );
  const [prevScreen, setPrevScreen] = useState<Screen>('map');
  const [fuel, setFuel] = useState<FuelId>(initialMap.fuel ?? persisted.fuel ?? 'diesel');
  usePersisted('fuel', fuel);
  const [sort, setSort] = useState<SortMode>('price');
  const [radius, setRadiusState] = useState<number>(
    initialMap.radius != null
      ? Math.min(initialMap.radius, MAX_RADIUS_KM)
      : (persisted.radius ?? 5),
  );
  // Persisted selections may predate a grouping change ("Total", "Esso
  // Express"…) — remap them onto the current canonical groups.
  const [brandSel, setBrandSelState] = useState<string[]>(() => [
    ...new Set((initialMap.brands ?? persisted.brandSel ?? []).map(brandGroup)),
  ]);
  usePersisted('brandSel', brandSel);
  const [serviceTags, setServiceTags] = useState<Partial<Record<ServiceTag, boolean>>>(() =>
    Object.fromEntries((initialMap.services ?? []).map((t) => [t, true])),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>('balanced');
  const [plannedStops, setPlannedStops] = useState<Record<string, boolean>>({});
  const [detailId, setDetailId] = useState<string | null>(
    persisted.onboarded ? initialNav.detailId : null,
  );
  const [fromText, setFromText] = useState('');
  // The departure defaults to « wherever I am ». It is a state flag, not a
  // string compared against a label: a translated label would silently stop
  // matching and the app would try to geocode the words « My position ».
  const [fromIsCurrentPosition, setFromIsCurrentPosition] = useState(true);
  const [toText, setToText] = useState('');
  const [fromPoint, setFromPoint] = useState<GeoPoint | null>(null);
  const [toPoint, setToPoint] = useState<GeoPoint | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const [vehicle, setVehicleState] = useState<VehicleId>(persisted.vehicle ?? 'car');
  const [tank, setTankState] = useState<number>(persisted.tank ?? VEHICLE_PRESETS.car.tank);
  const [consumption, setConsumptionState] = useState<number>(
    persisted.consumption ?? DEFAULT_CONSUMPTION,
  );
  const [avoidMotorway, setAvoidMotorwayState] = useState<boolean>(persisted.avoidMotorway ?? false);
  const [avoidToll, setAvoidTollState] = useState<boolean>(persisted.avoidToll ?? false);
  const [startTankPct, setStartTankPctState] = useState<number>(
    persisted.startTankPct ?? DEFAULT_START_TANK_PCT,
  );
  const [alerts, setAlertsState] = useState<boolean>(persisted.alerts ?? true);
  const [backgroundLocation, setBackgroundLocationState] = useState<boolean>(
    persisted.backgroundLocation ?? false,
  );
  // Forced migration to « Automatique » : legacy persisted ids ('gouv' before
  // the country rename) and new installs land on 'auto'; only explicit choices
  // of the current scheme survive.
  const [sourceId, setSourceIdState] = useState<DataSourceId>(() => {
    const saved = persisted.sourceId as string | undefined;
    return saved === 'fra' || saved === 'esp' || saved === 'and' || saved === 'prt' || saved === 'demo'
      ? saved
      : 'auto';
  });
  const [mapsSite, setMapsSiteState] = useState<MapsSiteId>(persisted.mapsSite ?? 'google');
  // Mirror of the Paraglide locale. Message functions read it from the runtime;
  // holding it in state is what re-renders the tree when the language changes.
  const [locale, setLocaleState] = useState<Locale>(() => currentLocale());
  const [localeIsExplicit, setLocaleIsExplicit] = useState(() => explicitLocale() != null);
  const [toast, setToast] = useState<string | null>(null);
  // Start from the last known position so the per-area cache hits instantly
  const initialPos = persisted.lastPos ?? DEFAULT_POS;
  const [userPos, setUserPos] = useState<GeoPoint>(initialPos);
  const [geoStatus, setGeoStatus] = useState<AppStore['geoStatus']>('pending');
  // Search area: follows the user's position until they search elsewhere on
  // the map — or until a shared link says which area to open on.
  const [searchPos, setSearchPos] = useState<GeoPoint>(initialMap.center ?? initialPos);
  const [searchLabel, setSearchLabel] = useState<string | null>(null);
  const [focusStationId, setFocusStationId] = useState<string | null>(null);
  // A link-provided area counts as « searched elsewhere »: the geolocation fix
  // landing right after must move the user dot, not the shared view.
  const searchMovedRef = useRef(initialMap.center != null);
  const [mapZoom, setMapZoomState] = useState<number | null>(initialMap.zoom);
  // Geolocation worked last session → hold the initial stations fetch until
  // the fresh fix lands (or a short fallback delay), so the app loads the
  // right area once instead of fetching the stale area and jumping. A shared
  // link already names its area: nothing to wait for.
  const [geoHold, setGeoHold] = useState<boolean>(
    initialMap.center == null &&
      persisted.onboarded === true &&
      persisted.geoGranted === true &&
      'geolocation' in navigator,
  );

  // Favorites pinned before the `fra-` prefix hold bare French ids — migrate
  // them, or they would stop matching the stations we load (star, sort, fiche).
  const [favorites, setFavorites] = useState<FavoriteStation[]>(() =>
    (persisted.favorites ?? []).map((f) => ({ ...f, id: normalizeStationId(f.id) })),
  );
  usePersisted('favorites', favorites);
  const toggleFavorite = useCallback((s: FavoriteStation) => {
    setFavorites((prev) => toggleFavoriteIn(prev, s));
  }, []);
  // Pull-up hint on the map sheet: armed when onboarding ends, spent as soon
  // as it plays (persisted, so quitting before the stations land keeps it)
  const [sheetHint, setSheetHint] = useState<boolean>(persisted.sheetHint ?? false);
  const consumeSheetHint = useCallback(() => {
    setSheetHint(false);
    savePersisted({ sheetHint: false });
  }, []);

  const [recents, setRecents] = useState<RecentPlace[]>(persisted.recents ?? DEFAULT_RECENTS);
  const [hasTripHistory, setHasTripHistory] = useState(persisted.recents != null);
  usePersisted('recents', recents);
  const [canInstall, setCanInstall] = useState(installReady());
  const [installDismissed, setInstallDismissed] = useState(persisted.installDismissed ?? false);
  const [stations, setStations] = useState<StationsState>({
    status: 'idle',
    data: [],
    activeSource: sourceId,
    fellBack: false,
    refreshing: false,
  });
  const [routeState, setRouteState] = useState<RouteState>({
    status: 'idle',
    route: null,
    stations: [],
    fellBack: false,
  });
  const [routeMatrix, setRouteMatrix] = useState<RouteMatrixState>({
    status: 'idle',
    key: null,
    cells: null,
  });

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // ── Geolocation ────────────────────────────────────────────────────────────
  const requestGeolocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unavailable');
      setGeoHold(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        if (!searchMovedRef.current) setSearchPos(p);
        setGeoStatus('granted');
        setGeoHold(false);
        savePersisted({ lastPos: p, geoGranted: true });
      },
      () => {
        setGeoStatus('denied');
        setGeoHold(false);
        savePersisted({ geoGranted: false });
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  const setSearchArea = useCallback((p: GeoPoint, label?: string) => {
    searchMovedRef.current = true;
    setSearchPos(p);
    setSearchLabel(label ?? null);
    // Picking a named place moves to a new context — drop the map selection
    // (free pans keep it: the user may be locating their selected station)
    if (label) setFocusStationId(null);
    savePersisted({ lastPos: p });
  }, []);

  // Leaflet owns the zoom; the store only mirrors it into the shareable URL
  const setMapZoom = useCallback((z: number) => {
    setMapZoomState((prev) => (prev === z ? prev : z));
  }, []);

  const resetSearchToUser = useCallback(() => {
    searchMovedRef.current = false;
    setSearchPos(userPos);
    setSearchLabel(null);
    setFocusStationId(null);
    requestGeolocation();
  }, [requestGeolocation, userPos]);

  // Returning users skipped onboarding → ask for the real position on mount
  useEffect(() => {
    if (persisted.onboarded) requestGeolocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Browser-history navigation (Android back navigates the app) ───────────
  // Every nav change pushes a history entry; popstate restores it, so the
  // system back button walks screens instead of leaving the app.
  const popNavRef = useRef(false);
  const lastNavScreenRef = useRef<Screen | null>(null);
  // Set when the next nav must swap the current entry instead of stacking one
  // (see `back()`: leaving a URL that can't be popped).
  const replaceNavRef = useRef(false);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = e.state as
        | { plein?: boolean; screen?: Screen; detailId?: string | null; filtersOpen?: boolean }
        | null;
      popNavRef.current = true;
      if (st?.plein && st.screen) {
        setScreen(st.screen);
        setDetailId(st.detailId ?? null);
        setFiltersOpen(!!st.filtersOpen);
      } else {
        const nav = navFromPath(window.location.pathname);
        setScreen(nav.screen);
        setDetailId(nav.detailId);
        setFiltersOpen(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The map view + its filters, as they appear in the URL. Panning rewrites
  // this several times a second (the circle tracks the finger) — the write
  // itself is throttled below.
  const mapQuery = useMemo(
    () =>
      mapUrlQuery({
        center: searchPos,
        zoom: mapZoom,
        fuel,
        radius,
        brands: brandSel,
        services: SERVICE_TAGS.filter((t) => serviceTags[t]),
      }),
    [searchPos, mapZoom, fuel, radius, brandSel, serviceTags],
  );
  // Browsers cap history writes (Safari: ~100 per 30 s) — a live pan would
  // blow through it, so map-params updates are throttled. Real navigations
  // always land immediately.
  const urlWrite = useRef<{ at: number; timer?: ReturnType<typeof setTimeout> }>({ at: 0 });
  useEffect(() => () => clearTimeout(urlWrite.current.timer), []);

  useEffect(() => {
    const fromPop = popNavRef.current;
    popNavRef.current = false;
    const cameFrom = lastNavScreenRef.current;
    lastNavScreenRef.current = screen;
    const replaceAsked = replaceNavRef.current;
    replaceNavRef.current = false;
    // A pending map-params write must never land on the entry we just moved to
    clearTimeout(urlWrite.current.timer);
    if (fromPop) return;
    // Onboarding parks the URL instead of rewriting it to `/`: a refresh in the
    // middle of the walkthrough must not cost the link the user followed. The
    // first nav after it replaces this entry (`cameFrom === 'onboarding'`).
    if (screen === 'onboarding') return;
    const cur = window.history.state as NavHistoryState | null;
    // Same screen: only the map's own params can differ, and they are worth a
    // URL update (the address bar stays a link to what is on screen) but never
    // a history entry.
    const sameNav =
      !!cur?.plein &&
      cur.screen === screen &&
      (cur.detailId ?? null) === detailId &&
      !!cur.filtersOpen === filtersOpen;
    const url = pathFor(screen, detailId) + (screen === 'map' ? mapQuery : '');
    if (sameNav && url === window.location.pathname + window.location.search) return;
    // First entry — and leaving onboarding must not be back-navigable
    const replace = !cur?.plein || cameFrom === 'onboarding' || replaceAsked || sameNav;
    // How deep the app is in ITS OWN history: entry 0 is the one the app was
    // opened on, and popping it would leave the app entirely.
    const idx = replace ? (cur?.plein ? (cur.idx ?? 0) : 0) : (cur?.idx ?? 0) + 1;
    const state: NavHistoryState = { plein: true, screen, detailId, filtersOpen, idx };
    const write = () => {
      urlWrite.current.at = Date.now();
      if (replace) window.history.replaceState(state, '', url);
      else window.history.pushState(state, '', url);
    };
    const wait = sameNav ? MAP_URL_MIN_MS - (Date.now() - urlWrite.current.at) : 0;
    if (wait <= 0) write();
    else urlWrite.current.timer = setTimeout(write, wait);
  }, [screen, detailId, filtersOpen, mapQuery]);

  // ── Stations near me (fetch at MAX radius, filter client-side) ─────────────
  // Stale-while-revalidate: a cached area paints instantly (refreshing: true)
  // while the live fetch runs; the UI flags outdated data via fetchedAt.
  // When the displayed zone lies FULLY inside a fresh cached area, there is
  // nothing to fetch at all — slight map moves re-use the stations already
  // loaded, exactly like the prefetched basemap tiles.
  const stationsReq = useRef(0);
  // Area whose stations currently sit in memory. Live circle drags update
  // searchPos several times a second — when the zone still fits inside this
  // area with fresh data there is nothing to load at all (no localStorage
  // parse, no network): the client-side filters do all the work.
  const loadedArea = useRef<{
    source: DataSourceId;
    center: GeoPoint;
    radiusKm: number;
    fetchedAt: number;
  } | null>(null);
  const loadStations = useCallback(async () => {
    const area = loadedArea.current;
    if (
      area &&
      area.source === sourceId &&
      Date.now() - area.fetchedAt < STALE_MS &&
      haversineKm(area.center, searchPos) + radius <= area.radiusKm
    ) {
      return;
    }
    const reqId = ++stationsReq.current;
    const cached = readStationsCache(sourceId, searchPos, radius);
    if (cached && cached.covers && Date.now() - cached.fetchedAt < STALE_MS) {
      if (cached.center && cached.fetchRadiusKm != null) {
        loadedArea.current = {
          source: sourceId,
          center: cached.center,
          radiusKm: cached.fetchRadiusKm,
          fetchedAt: cached.fetchedAt,
        };
      }
      setStations({
        status: 'ready',
        data: cached.stations,
        activeSource: sourceId,
        fellBack: false,
        fetchedAt: cached.fetchedAt,
        refreshing: false,
      });
      return;
    }
    if (cached) {
      setStations({
        status: 'ready',
        data: cached.stations,
        activeSource: sourceId,
        fellBack: false,
        fetchedAt: cached.fetchedAt,
        refreshing: true,
      });
    } else {
      setStations((s) => ({ ...s, status: 'loading', refreshing: false }));
    }
    const bundle = getProviders(sourceId);
    try {
      // Refreshing behind painted cache → don't compete with visible work
      const data = await bundle.stations.getStationsNear(searchPos, MAX_RADIUS_KM, {
        lowPriority: cached != null,
      });
      if (reqId !== stationsReq.current) return;
      const fetchedAt = Date.now();
      writeStationsCache(sourceId, searchPos, MAX_RADIUS_KM, data, fetchedAt);
      loadedArea.current = { source: sourceId, center: searchPos, radiusKm: MAX_RADIUS_KM, fetchedAt };
      setStations({
        status: 'ready',
        data,
        activeSource: sourceId,
        fellBack: false,
        fetchedAt,
        refreshing: false,
      });
    } catch {
      if (reqId !== stationsReq.current) return;
      // Failed loads must not shadow future retries behind the fast path
      loadedArea.current = null;
      // Refresh failed but the cache is on screen → keep it, flagged as outdated.
      if (cached) {
        setStations((s) => ({ ...s, refreshing: false }));
        return;
      }
      // Real source down with nothing cached → substitute demo data, visibly.
      if (sourceId !== 'demo') {
        try {
          const demo = await getProviders('demo').stations.getStationsNear(searchPos, MAX_RADIUS_KM);
          if (reqId !== stationsReq.current) return;
          setStations({
            status: 'ready',
            data: demo,
            activeSource: 'demo',
            fellBack: true,
            fetchedAt: Date.now(),
            refreshing: false,
          });
          return;
        } catch {
          /* fall through */
        }
      }
      if (reqId !== stationsReq.current) return;
      setStations({
        status: 'error',
        data: [],
        activeSource: sourceId,
        fellBack: false,
        refreshing: false,
      });
    }
  }, [sourceId, searchPos, radius]);

  useEffect(() => {
    if (geoHold) return;
    void loadStations();
  }, [loadStations, geoHold]);

  // Never wait on a slow GPS fix forever — release the hold after a beat and
  // load the last known area (the fix will re-center when it finally lands).
  useEffect(() => {
    if (!geoHold) return;
    const t = setTimeout(() => setGeoHold(false), 4000);
    return () => clearTimeout(t);
  }, [geoHold]);

  // ── Road distances (single OSRM table call, estimate as fallback) ─────────
  // Crow-flies underestimates every trip (rivers, ring roads…) and distorts
  // the effective-price ranking. One matrix request fills real road km and
  // drive minutes for the stations nearest the user; everything else — and
  // any network failure — falls back to the CROW_ROAD_FACTOR estimate.
  const [roadReach, setRoadReach] = useState<Record<string, ReachInfo>>({});
  const reachKey = useRef<string | null>(null);
  useEffect(() => {
    const provider = getProviders(stations.activeSource).route;
    // Nothing measurable this round → drop what the last round measured. Those
    // numbers were measured from a position the user may since have left, and
    // keeping them would show distances from there; crow-flies is the honest
    // degradation. The key goes too, so the very same set can be measured
    // again once it becomes reachable.
    const dropReach = () => {
      reachKey.current = null;
      setRoadReach((prev) => (Object.keys(prev).length ? {} : prev));
    };
    if (!provider.getReachMatrix || !stations.data.length) {
      dropReach();
      return;
    }
    const candidates = selectReachCandidates(stations.data, userPos);
    if (!candidates.length) {
      dropReach();
      return;
    }
    // ~100 m position granularity: a GPS jitter must not refetch the matrix
    const key = [
      stations.activeSource,
      userPos.lat.toFixed(3),
      userPos.lng.toFixed(3),
      ...candidates.map((s) => s.id),
    ].join('|');
    if (key === reachKey.current) return;
    reachKey.current = key;
    provider
      .getReachMatrix(
        userPos,
        candidates.map((s) => ({ lat: s.lat, lng: s.lng })),
      )
      .then((reach) => {
        if (reachKey.current !== key) return;
        const next: Record<string, ReachInfo> = {};
        candidates.forEach((s, i) => {
          const r = reach[i];
          if (r) next[s.id] = r;
        });
        setRoadReach(next);
      })
      .catch(() => {
        // Crow-flies stays on screen; clearing the key lets the next data
        // refresh retry instead of pinning the failure until the user moves
        if (reachKey.current === key) reachKey.current = null;
      });
  }, [stations.activeSource, stations.data, userPos]);

  // ── Auto-refresh: keep prices fresh while the app is open and online ───────
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  useEffect(() => {
    const tick = () => {
      if (document.hidden || navigator.onLine === false) return;
      const st = stationsRef.current;
      if (st.status !== 'ready' || st.refreshing) return;
      if (!st.fetchedAt || Date.now() - st.fetchedAt < STALE_MS) return;
      void loadStations();
    };
    const iv = setInterval(tick, 60_000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadStations]);

  // ── PWA install ────────────────────────────────────────────────────────────
  useEffect(() => subscribeInstall(() => setCanInstall(installReady())), []);

  const promptInstall = useCallback(() => {
    void nativeInstallPrompt().then((outcome) => {
      if (outcome === 'dismissed') {
        setInstallDismissed(true);
        savePersisted({ installDismissed: true });
      }
    });
  }, []);

  const dismissInstallBanner = useCallback(() => {
    setInstallDismissed(true);
    savePersisted({ installDismissed: true });
  }, []);

  // ── Route computation ──────────────────────────────────────────────────────
  /**
   * Record a real trip in the « Récents » history (replaces the default
   * suggestions): its destination, and its departure when the user named one.
   * The distance and the date are stored as numbers, not as a ready-made
   * sentence: the row is written in whatever language the app is in when it is
   * READ, not when the trip was made.
   */
  const pushRecent = useCallback(
    (places: { label: string; point: GeoPoint }[], distanceKm: number) => {
      const at = Date.now();
      const entries = places.map((p) => ({ ...p, distanceKm, at }));
      setRecents((prev) => pushTripIn(prev, entries, hasTripHistory));
      setHasTripHistory(true);
    },
    [hasTripHistory],
  );

  const routeReq = useRef(0);
  const computeRoute = useCallback(
    // `fromLabel` is null when the trip departs from the user's position:
    // « Ma position » is copy, not a place worth remembering.
    async (from: GeoPoint, to: GeoPoint, toLabel: string, fromLabel: string | null) => {
      const trip = fromLabel
        ? [
            { label: fromLabel, point: from },
            { label: toLabel, point: to },
          ]
        : [{ label: toLabel, point: to }];
      const reqId = ++routeReq.current;
      setRouteState((s) => ({ ...s, status: 'loading' }));
      const run = async (src: DataSourceId) => {
        const bundle = getProviders(src);
        const route = await bundle.route.getRoute(from, to, { avoidMotorway, avoidToll, vehicle });
        const raw = await bundle.stations.getStationsAlong(route.polyline, 5);
        // The whole corridor is kept: the optimizer picks its own bounded,
        // geographically distributed candidate set (lib/routeCandidates) —
        // capping here on price destroyed coverage at the start of long routes.
        // This is also the ONE place the corridor gets projected (see
        // projectCorridor): measuring is O(stations × polyline vertices), far
        // too expensive for a selector that reruns on every store update.
        const enriched: RouteStation[] = projectCorridor(route, raw)
          .filter((st) => st.kmAlong > 1 && st.kmAlong < route.distanceKm - 1)
          .sort((a, b) => a.kmAlong - b.kmAlong);
        return { route, stations: enriched };
      };
      try {
        const res = await run(sourceId);
        if (reqId !== routeReq.current) return;
        setRouteState({ status: 'ready', ...res, fellBack: false });
        pushRecent(trip, res.route.distanceKm);
      } catch {
        if (reqId !== routeReq.current) return;
        if (sourceId !== 'demo') {
          try {
            const res = await run('demo');
            if (reqId !== routeReq.current) return;
            setRouteState({ status: 'ready', ...res, fellBack: true });
            pushRecent(trip, res.route.distanceKm);
            return;
          } catch {
            /* fall through */
          }
        }
        if (reqId !== routeReq.current) return;
        setRouteState({
          status: 'error',
          route: null,
          stations: [],
          fellBack: false,
          error: m.route_error_unavailable(),
        });
      }
    },
    [sourceId, pushRecent, avoidMotorway, avoidToll, vehicle],
  );

  // ── Route travel matrix (one call per route + candidate set) ───────────────
  // Road legs for the fuel-stop plan: origin → stations → destination in ONE
  // matrix request — never one routing call per station. While it loads or
  // when it fails, selectors run the plan on the geometric estimate instead
  // (flagged `estimated`), so the ribbon always has an answer.
  const matrixKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const route = routeState.route;
    if (routeState.status !== 'ready' || !route || !fromPoint || !toPoint) {
      matrixKeyRef.current = null;
      setRouteMatrix((m) => (m.status === 'idle' ? m : { status: 'idle', key: null, cells: null }));
      return;
    }
    const src: DataSourceId = routeState.fellBack ? 'demo' : sourceId;
    const provider = getProviders(src).route;
    const candidates = planCandidatesFor(
      routeState,
      fuel,
      { tank, consumption, startTankPct },
      plannedStops,
      provider.travelMatrixMaxPoints,
    );
    if (!provider.getTravelMatrix || !candidates.length) {
      matrixKeyRef.current = null;
      setRouteMatrix((m) =>
        m.status === 'error' ? m : { status: 'error', key: null, cells: null },
      );
      return;
    }
    const key = travelMatrixKey(src, fromPoint, toPoint, candidates, {
      avoidMotorway,
      avoidToll,
      vehicle,
    });
    if (matrixKeyRef.current === key) return;
    matrixKeyRef.current = key;
    setRouteMatrix({ status: 'loading', key, cells: null });
    const points: GeoPoint[] = [
      fromPoint,
      ...candidates.map((c) => ({ lat: c.station.lat, lng: c.station.lng })),
      toPoint,
    ];
    provider
      .getTravelMatrix(points, { avoidMotorway, avoidToll, vehicle })
      .then((cells) => {
        if (matrixKeyRef.current !== key) return;
        setRouteMatrix({ status: 'ready', key, cells });
      })
      .catch(() => {
        if (matrixKeyRef.current !== key) return;
        // The key stays: the same set is not refetched in a loop — the next
        // candidate change retries, the estimate carries the plan meanwhile.
        setRouteMatrix({ status: 'error', key, cells: null });
      });
  }, [
    routeState,
    fromPoint,
    toPoint,
    sourceId,
    fuel,
    tank,
    consumption,
    startTankPct,
    plannedStops,
    avoidMotorway,
    avoidToll,
    vehicle,
  ]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const go = useCallback((s: Screen) => {
    setScreen((cur) => {
      if (s === 'detail') setPrevScreen(cur);
      return s;
    });
  }, []);

  const openStation = useCallback(
    (id: string) => {
      setDetailId(id);
      go('detail');
    },
    [go],
  );

  const back = useCallback(() => {
    const cur = window.history.state as NavHistoryState | null;
    if (cur?.plein && cur.screen === 'detail') {
      if ((cur.idx ?? 0) > 0) {
        window.history.back();
        return;
      }
      // Entry 0: the app was opened directly on this fiche (deep link, fresh
      // tab) — popping would leave the app. Swap the entry in place instead,
      // so Back can't walk right back onto the URL we just left.
      replaceNavRef.current = true;
    }
    setScreen(prevScreen);
  }, [prevScreen]);

  // Closing the filters sheet from the UI pops the entry its opening pushed,
  // so a later back press doesn't re-close an already-closed sheet.
  const setFiltersOpenNav = useCallback((open: boolean) => {
    const cur = window.history.state as { plein?: boolean; filtersOpen?: boolean } | null;
    if (!open && cur?.plein && cur.filtersOpen) window.history.back();
    else setFiltersOpen(open);
  }, []);

  const cycleFuel = useCallback(() => {
    setFuel(nextFuelAfter);
  }, []);

  const setRadius = useCallback((r: number) => {
    setRadiusState(r);
    savePersisted({ radius: r });
  }, []);

  const setTank = useCallback((t: number) => {
    setTankState(t);
    savePersisted({ tank: t });
  }, []);

  const setConsumption = useCallback((v: number) => {
    setConsumptionState(v);
    savePersisted({ consumption: v });
  }, []);

  const setVehicle = useCallback((v: VehicleId) => {
    setVehicleState(v);
    const preset = VEHICLE_PRESETS[v];
    setTankState(preset.tank);
    setConsumptionState(preset.consumption);
    // A motorcycle runs on SP95-E10, not diesel — the fuel follows the profile
    setFuel(preset.fuel);
    // `fuel` rides along through `usePersisted`
    savePersisted({ vehicle: v, tank: preset.tank, consumption: preset.consumption });
  }, []);

  const setAvoidMotorway = useCallback((v: boolean) => {
    setAvoidMotorwayState(v);
    savePersisted({ avoidMotorway: v });
  }, []);

  const setAvoidToll = useCallback((v: boolean) => {
    setAvoidTollState(v);
    savePersisted({ avoidToll: v });
  }, []);

  const setStartTankPct = useCallback((v: number) => {
    setStartTankPctState(v);
    savePersisted({ startTankPct: v });
  }, []);

  const setAlerts = useCallback((v: boolean) => {
    setAlertsState(v);
    savePersisted({ alerts: v });
  }, []);

  const setBackgroundLocation = useCallback((v: boolean) => {
    setBackgroundLocationState(v);
    savePersisted({ backgroundLocation: v });
  }, []);

  const setSourceId = useCallback((s: DataSourceId) => {
    setSourceIdState(s);
    savePersisted({ sourceId: s });
  }, []);

  const setMapsSite = useCallback((s: MapsSiteId) => {
    setMapsSiteState(s);
    savePersisted({ mapsSite: s });
  }, []);

  /**
   * Pick a language, or `null` to follow the browser again. Paraglide owns the
   * resolution and the persistence; the state mirror is what re-renders the
   * tree, since message functions are plain imports React cannot subscribe to.
   */
  const setLocale = useCallback((next: Locale | null) => {
    if (next) {
      applyLocale(next);
      setLocaleState(next);
      setLocaleIsExplicit(true);
    } else {
      setLocaleState(followBrowserLocale());
      setLocaleIsExplicit(false);
    }
  }, []);

  // Keep <html lang> and the page title in the active language
  useEffect(() => {
    syncDocumentLocale(m.app_title());
  }, [locale]);

  const toggleBrand = useCallback((label: string) => {
    setBrandSelState((sel) => toggleBrandIn(sel, label));
  }, []);

  const resetFilters = useCallback(() => {
    setRadius(5);
    setBrandSelState([]);
    setServiceTags({});
    setFuel('diesel');
  }, [setFuel, setRadius]);

  const searchPlaces = useCallback(
    (q: string, opts?: GeocodeSearchOptions) => getProviders(sourceId).geocode.search(q, opts),
    [sourceId],
  );

  const setFrom = useCallback((text: string, point: GeoPoint | null = null) => {
    setFromText(text);
    setFromIsCurrentPosition(false);
    setFromPoint(point);
    setRouteReady(false);
  }, []);

  const useCurrentPositionAsStart = useCallback(() => {
    setFromText('');
    setFromIsCurrentPosition(true);
    setFromPoint(null);
    setRouteReady(false);
  }, []);

  const setTo = useCallback((text: string, point: GeoPoint | null = null) => {
    setToText(text);
    setToPoint(point);
    setRouteReady(false);
  }, []);

  const startRoute = useCallback(async () => {
    if (!toText.trim()) return;
    let from = fromPoint;
    let to = toPoint;
    let toLabel = toText.trim();
    // A departure the user named is remembered like the destination; « Ma
    // position » is not a place, hence null.
    let fromLabel = fromIsCurrentPosition ? null : fromText.trim() || null;
    const geocode = getProviders(sourceId).geocode;
    try {
      if (!from) {
        if (fromIsCurrentPosition || !fromText.trim()) {
          from = userPos;
          fromLabel = null;
        } else {
          const r = await geocode.search(fromText);
          from = r[0]?.point ?? null;
          if (r[0]) {
            setFromText(r[0].label);
            fromLabel = r[0].label;
          }
        }
      }
      if (!to) {
        const r = await geocode.search(toText);
        to = r[0]?.point ?? null;
        if (r[0]) {
          setToText(r[0].label);
          toLabel = r[0].label;
        }
      }
    } catch {
      /* geocode failure handled below */
    }
    if (!from || !to) {
      showToast(m.toast_address_not_found());
      return;
    }
    setFromPoint(from);
    setToPoint(to);
    setPlannedStops({});
    setRouteReady(true);
    setScreen('route');
    void computeRoute(from, to, toLabel, fromLabel);
  }, [
    computeRoute,
    fromIsCurrentPosition,
    fromPoint,
    fromText,
    showToast,
    sourceId,
    toPoint,
    toText,
    userPos,
  ]);

  const editRoute = useCallback(() => setScreen('routeSetup'), []);

  const [focusDestination, setFocusDestination] = useState(false);
  const openRouteSearch = useCallback(() => {
    setFocusDestination(true);
    setScreen('routeSetup');
  }, []);
  const consumeFocusDestination = useCallback(() => setFocusDestination(false), []);

  const togglePlannedStop = useCallback((id: string) => {
    setPlannedStops((t) => ({ ...t, [id]: !t[id] }));
  }, []);

  const openInMaps = useCallback(
    (target: Station) => {
      // Android: geo: URI → the native maps-app chooser (Google Maps, Waze,
      // Organic Maps…). iOS/iPadOS: Apple Plans universal link. Elsewhere:
      // the web maps site chosen in Réglages.
      // A brand-matched station exists as a mapped POI: hand the maps app a
      // text search (anchored on our coordinates) so it opens its own place
      // card instead of a bare coordinate pin, which it never links to the
      // POI. Unbranded stations keep the labeled pin — a text search for
      // « Station » would be a lottery.
      const poiQuery = target.brand
        ? encodeURIComponent(
            [target.brand, target.address, target.postalCode, target.city]
              .filter(Boolean)
              .join(' '),
          )
        : null;
      if (IS_ANDROID) {
        showToast(m.toast_opening_gps_app());
        const label = encodeURIComponent(target.name);
        const q = poiQuery ?? `${target.lat},${target.lng}(${label})`;
        window.location.href = `geo:${target.lat},${target.lng}?q=${q}`;
        return;
      }
      if (IS_IOS) {
        showToast(m.toast_opening_maps({ site: m.maps_site_apple() }));
        window.location.href = `https://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d`;
        return;
      }
      // Desktop: the site is a Réglages choice (Google Maps by default).
      // Unlike geo:, the Google dir URL carries no coordinate anchor for a
      // text search — only use it when a street address can disambiguate.
      const site = MAPS_SITE_IDS.includes(mapsSite) ? mapsSite : MAPS_SITE_IDS[0];
      showToast(m.toast_opening_maps({ site: mapsSiteLabel(site) }));
      const url =
        site === 'google' && poiQuery && target.address
          ? `https://www.google.com/maps/dir/?api=1&destination=${poiQuery}&travelmode=driving`
          : mapsSiteUrl(site, target.lat, target.lng);
      window.open(url, '_blank', 'noopener');
    },
    [showToast, mapsSite],
  );

  const openPlannedStopsInMaps = useCallback(() => {
    const stops = routeState.stations.filter((s) => plannedStops[s.id]);
    if (!stops.length || !toPoint) return;
    // Multi-stop URLs are a Google Maps feature — used on every platform
    // (Android/iOS open the Google Maps app via universal links when installed).
    showToast(m.toast_opening_maps({ site: m.maps_site_google() }));
    const waypoints = stops.map((s) => `${s.lat},${s.lng}`).join('|');
    const origin = fromPoint ? `&origin=${fromPoint.lat},${fromPoint.lng}` : '';
    const url = `https://www.google.com/maps/dir/?api=1${origin}&destination=${toPoint.lat},${toPoint.lng}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    window.open(url, '_blank', 'noopener');
  }, [fromPoint, plannedStops, routeState.stations, showToast, toPoint]);

  const copyShareLink = useCallback(
    (url: string) => {
      if (!navigator.clipboard) {
        showToast(m.toast_share_unavailable());
        return;
      }
      navigator.clipboard.writeText(url).then(
        () => showToast(m.toast_link_copied()),
        () => showToast(m.toast_share_unavailable()),
      );
    },
    [showToast],
  );

  /** Hand a link to the system sheet, clipboard otherwise — every share goes through here */
  const share = useCallback(
    (data: ShareData) => {
      // navigator.share must be reached from the click itself: awaiting
      // anything first spends the transient activation and iOS Safari refuses.
      if (navigator.share) {
        navigator.share(data).catch((err: unknown) => {
          // Dismissing the system sheet rejects with AbortError — that is the
          // user changing their mind, not a failure to fall back from.
          if ((err as DOMException)?.name === 'AbortError') return;
          copyShareLink(data.url);
        });
        return;
      }
      copyShareLink(data.url);
    },
    [copyShareLink],
  );

  const shareStation = useCallback(
    (target: Station) => {
      const priced = effectiveFuel(target, fuel);
      const value = priced ? target.prices[priced]?.value : undefined;
      share(
        stationShareData(
          target,
          window.location.origin,
          priced && value != null ? { fuelLabel: fuelLabel(priced), value } : null,
        ),
      );
    },
    [fuel, share],
  );

  /**
   * Share the map as it stands. In a standalone PWA there is no address bar
   * to copy the link from, so it is rebuilt from the state — same query the
   * URL carries, same share path as a station fiche.
   */
  const shareMapView = useCallback(() => {
    share(
      mapViewShareData(
        {
          center: searchPos,
          zoom: mapZoom,
          fuel,
          radius,
          brands: brandSel,
          services: SERVICE_TAGS.filter((t) => serviceTags[t]),
        },
        window.location.origin,
        { fuelLabel: fuelLabel(fuel), place: searchLabel },
      ),
    );
  }, [brandSel, fuel, mapZoom, radius, searchLabel, searchPos, serviceTags, share]);

  const finishOnboarding = useCallback(
    (withGeoloc: boolean) => {
      savePersisted({ onboarded: true, sheetHint: true });
      setSheetHint(true);
      if (withGeoloc) requestGeolocation();
      else setGeoStatus('denied');
      // Land on whatever the opened URL asked for — the map is just the
      // default when the app was opened on `/`.
      const target = pendingNav.current;
      pendingNav.current = null;
      setDetailId(target?.detailId ?? null);
      setScreen(target?.screen ?? 'map');
    },
    [requestGeolocation],
  );

  const store = useMemo<AppStore>(
    () => ({
      screen,
      prevScreen,
      go,
      back,
      openStation,
      fuel,
      setFuel,
      cycleFuel,
      sort,
      setSort,
      radius,
      setRadius,
      brandSel,
      toggleBrand,
      serviceTags,
      toggleServiceTag: (t) => setServiceTags((s) => ({ ...s, [t]: !s[t] })),
      filtersOpen,
      setFiltersOpen: setFiltersOpenNav,
      resetFilters,
      userPos,
      geoStatus,
      hasKnownPos: persisted.lastPos != null || geoStatus === 'granted',
      requestGeolocation,
      searchPos,
      searchedAway: haversineKm(searchPos, userPos) > 0.5,
      searchLabel,
      setSearchArea,
      resetSearchToUser,
      focusStationId,
      setFocusStation: setFocusStationId,
      mapZoom,
      setMapZoom,
      favorites,
      isFavorite: (id) => favorites.some((f) => f.id === id),
      toggleFavorite,
      stations,
      reloadStations: () => void loadStations(),
      roadReach,
      fromText,
      fromIsCurrentPosition,
      toText,
      fromPoint,
      toPoint,
      setFrom,
      useCurrentPositionAsStart,
      setTo,
      searchPlaces,
      recents,
      hasTripHistory,
      routeReady,
      startRoute: () => void startRoute(),
      editRoute,
      openRouteSearch,
      focusDestination,
      consumeFocusDestination,
      routeMode,
      setRouteMode,
      avoidMotorway,
      avoidToll,
      setAvoidMotorway,
      setAvoidToll,
      startTankPct,
      setStartTankPct,
      routeState,
      routeMatrix,
      plannedStops,
      togglePlannedStop,
      vehicle,
      setVehicle,
      tank,
      setTank,
      consumption,
      setConsumption,
      alerts,
      setAlerts,
      backgroundLocation,
      setBackgroundLocation,
      sourceId,
      setSourceId,
      mapsSite,
      setMapsSite,
      locale,
      localeIsExplicit,
      setLocale,
      detailId,
      installReady: canInstall && !isStandalone(),
      installBannerVisible: canInstall && !isStandalone() && !installDismissed,
      promptInstall,
      dismissInstallBanner,
      toast,
      notify: showToast,
      openInMaps,
      openPlannedStopsInMaps,
      shareStation,
      shareMapView,
      finishOnboarding,
      sheetHint,
      consumeSheetHint,
    }),
    [
      screen, prevScreen, go, back, openStation, fuel, setFuel, cycleFuel, sort, radius, setRadius,
      brandSel, toggleBrand, serviceTags, filtersOpen, resetFilters, userPos, geoStatus,
      requestGeolocation, searchPos, searchLabel, setSearchArea, resetSearchToUser,
      focusStationId, mapZoom, setMapZoom,
      favorites, toggleFavorite, stations, roadReach, loadStations, fromText, fromIsCurrentPosition,
      toText, fromPoint, toPoint,
      setFrom, useCurrentPositionAsStart, setTo, searchPlaces, recents, hasTripHistory, routeReady,
      startRoute, editRoute, openRouteSearch, focusDestination, consumeFocusDestination,
      routeMode, routeState, routeMatrix, plannedStops, togglePlannedStop, vehicle, setVehicle, tank, setTank,
      consumption, setConsumption,
      avoidMotorway, avoidToll, setAvoidMotorway, setAvoidToll, startTankPct, setStartTankPct,
      setFiltersOpenNav, alerts, setAlerts,
      backgroundLocation, setBackgroundLocation, sourceId, setSourceId, mapsSite, setMapsSite,
      locale, localeIsExplicit, setLocale, detailId, toast, showToast,
      canInstall, installDismissed, promptInstall, dismissInstallBanner, persisted.lastPos,
      openInMaps, openPlannedStopsInMaps, shareStation, shareMapView, finishOnboarding,
      sheetHint, consumeSheetHint,
    ],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/**
 * Departure shown in the route UI. « Ma position » is copy, not a value: the
 * store carries a flag and the label is produced here, so translating it can
 * never change what the route actually departs from.
 */
export function routeFromLabel(
  app: Pick<AppStore, 'fromText' | 'fromIsCurrentPosition'>,
): string {
  return app.fromIsCurrentPosition ? m.route_from_current_position() : app.fromText;
}

export function useApp(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

// ── Derived selectors (pure — shared by every screen) ────────────────────────

/**
 * Selectors are pure functions of the store they are handed, and a render
 * pass calls them dozens of times: `MapSheet` alone reaches for eight, each
 * re-deriving the same projection over the whole `stations.data`. `cached`
 * wraps a selector so that work happens ONCE per store object — write the
 * selector as usual, wrap it, and every caller shares the result.
 *
 * The contract this rests on: a store object is never mutated in place. The
 * provider rebuilds it (see the `useMemo` above) whenever any input changes,
 * so a new identity means new inputs, and callers holding an older object —
 * a stale closure inside an effect, say — keep getting the answers that
 * object describes. A field mutated behind a stable identity would already
 * be invisible to consumers (React skips the re-render), so this adds no
 * failure mode the store didn't already have.
 *
 * Two things to know when writing one:
 * - results are SHARED, hence read-only: copy before sorting
 *   (`[...selectVisible(app)].sort(…)`), as every call site already does;
 * - extra arguments join the cache key, so they must be primitives — a
 *   selector taking an object stays uncached (`selectZoneDelta`).
 *
 * `WeakMap` keeps it leak-free: entries die with the store they describe.
 */
const selectorCache = new WeakMap<object, Map<string, unknown>>();
let selectorId = 0;

function cached<A extends (string | number)[], T>(
  select: (app: AppStore, ...args: A) => T,
): (app: AppStore, ...args: A) => T {
  const id = `${selectorId++}`;
  return (app, ...args) => {
    let entries = selectorCache.get(app);
    if (!entries) {
      entries = new Map();
      selectorCache.set(app, entries);
    }
    const key = `${id}:${args.join('|')}`;
    if (entries.has(key)) return entries.get(key) as T;
    const value = select(app, ...args);
    entries.set(key, value);
    return value;
  };
}

/**
 * Fuel actually compared and displayed for a station. E10 barely exists in
 * Spain (a handful of stations country-wide) and not at all in Andorra or
 * Portugal — their SP95 (E5) is what an E10 vehicle fills up there, so those
 * stations join the E10 map with their SP95 price. Never the reverse: an
 * SP95-only engine must not be sent to an E10 pump, and French stations list
 * both fuels separately anyway.
 */
const SP95_FOR_E10: ReadonlyArray<StationCountry> = ['esp', 'and', 'prt'];

export function effectiveFuel(s: Station, fuel: FuelId): FuelId | null {
  if (s.prices[fuel] != null) return fuel;
  const country = stationCountry(s.id);
  if (fuel === 'e10' && s.prices.unleaded95 != null && country && SP95_FOR_E10.includes(country)) {
    return 'unleaded95';
  }
  return null;
}

/** Price of the effective fuel (undefined when the station sells neither) */
export function effectivePrice(s: Station, fuel: FuelId): FuelPrice | undefined {
  const f = effectiveFuel(s, fuel);
  return f ? s.prices[f] : undefined;
}

/**
 * Cheapest and dearest price for a fuel across a comparison set — what the
 * fiche's « le + bas » note and its savings figure are measured against.
 * Read through effectivePrice so the set holds the same stations the map and
 * the list show: an E10 comparison in Spain or Andorra is made of SP95
 * prices, and reading the raw `prices.e10` would leave it empty — no max, no
 * saving, a fiche claiming 0,00 € on every Spanish station.
 */
export function fuelRange(
  stations: Station[],
  fuel: FuelId,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of stations) {
    const p = effectivePrice(s, fuel)?.value;
    if (p == null) continue;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return min === Infinity ? null : { min, max };
}

/**
 * Stations worth one road-matrix call: the ROAD_REACH_MAX nearest ones, and
 * only those within MAX_RADIUS_KM of the user. When the user searches a
 * faraway area, its stations are not "near me" in any sense worth a routing
 * call — they keep crow-flies distances and the list comes back empty.
 */
export function selectReachCandidates(stations: Station[], userPos: GeoPoint): Station[] {
  return stations
    .map((s) => ({ s, crowKm: haversineKm(userPos, { lat: s.lat, lng: s.lng }) }))
    .filter((c) => c.crowKm <= MAX_RADIUS_KM)
    .sort((a, b) => a.crowKm - b.crowKm)
    .slice(0, ROAD_REACH_MAX)
    .map((c) => c.s);
}

// CROW_ROAD_FACTOR (imported above): only the ROAD_REACH_MAX nearest stations
// get measured road numbers; without that factor the others would be ranked —
// and shown — on a shorter scale than the measured ones and would steal a
// recommendation they don't deserve.
/** ~40 km/h door-to-pump, for stations the reach matrix did not cover */
const FALLBACK_MIN_PER_KM = 1.5;

/**
 * Distance & drive time to a station, ALWAYS on the road scale: measured
 * numbers when the reach matrix covered it, an estimate derived from
 * crow-flies otherwise. The two must never be mixed — the effective-price
 * ranking compares them against each other.
 */
export function roadReachOf(
  crowKm: number,
  reach?: ReachInfo,
): { distKm: number; driveMin: number } {
  const distKm = reach?.distanceKm ?? crowKm * CROW_ROAD_FACTOR;
  return {
    distKm,
    driveMin: Math.max(1, Math.round(reach ? reach.durationMin : distKm * FALLBACK_MIN_PER_KM)),
  };
}

/**
 * Distance/time enrichment shared by the zone and map selectors. The radius
 * filter always uses crow-flies from the search center — it describes the
 * search area, not a drive.
 */
function enrichDistance(app: AppStore, s: Station): NearbyStation {
  const crowKm = haversineKm(app.userPos, { lat: s.lat, lng: s.lng });
  const searchKm = haversineKm(app.searchPos, { lat: s.lat, lng: s.lng });
  return { ...s, ...roadReachOf(crowKm, app.roadReach[s.id]), searchKm };
}

/**
 * THE pass over `stations.data` — two haversines per station, and the only
 * place they are paid. Everything below narrows this list with cheap
 * predicates (a radius comparison, a brand lookup, a price presence check),
 * so a whole render tree costs one distance pass instead of twenty.
 */
const selectEnriched = cached((app: AppStore): NearbyStation[] =>
  app.stations.data.map((s) => enrichDistance(app, s)),
);

/** Enriched stations passing the service-tag filter (no radius, brand or fuel) */
const selectTagged = cached((app: AppStore): NearbyStation[] => {
  const { serviceTags } = app;
  const wantedTags = (Object.keys(serviceTags) as ServiceTag[]).filter((t) => serviceTags[t]);
  if (!wantedTags.length) return selectEnriched(app);
  return selectEnriched(app).filter((s) => wantedTags.every((t) => s.tags.includes(t)));
});

/** Brandless stations pass as the « independent » group via brandGroup */
function passesBrand(app: AppStore, s: NearbyStation): boolean {
  return app.brandSel.length === 0 || app.brandSel.includes(brandGroup(s.brand));
}

/**
 * Zone stations with the brand selection IGNORED — the population the
 * « Distributeurs » counts are grouped from, and the shared base of the
 * brand-filtered zone.
 */
const selectZoneAllBrands = cached((app: AppStore): NearbyStation[] =>
  selectTagged(app).filter((s) => s.searchKm <= app.radius),
);

/** Zone stations passing every filter EXCEPT the fuel one */
const selectZoneStations = cached((app: AppStore): NearbyStation[] =>
  selectZoneAllBrands(app).filter((s) => passesBrand(app, s)),
);

/** Stations passing the current filters, enriched with distance, for a given fuel */
export const selectVisibleForFuel = cached((app: AppStore, fuel: FuelId): NearbyStation[] =>
  selectZoneStations(app).filter((s) => effectivePrice(s, fuel) != null),
);

/** Stations passing the current filters, for the currently selected fuel */
export function selectVisible(app: AppStore): NearbyStation[] {
  return selectVisibleForFuel(app, app.fuel);
}

/**
 * Station count per brand group inside the zone, for the « Distributeurs »
 * rows. Counted with `brandSel` ignored — so the list doesn't collapse as
 * brands are picked — but WITH the fuel and service filters applied: a row
 * promising « 3 » must deliver 3 stations once selected, never an empty map.
 * A group with nothing to show here is simply absent from the result — the
 * sheet lists it among the brands kept for a next trip.
 */
export const selectZoneBrandCounts = cached((app: AppStore): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const s of selectZoneAllBrands(app)) {
    if (effectivePrice(s, app.fuel) == null) continue;
    const g = brandGroup(s.brand);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
});

/**
 * Fuels actually sold in the zone (radius + brand/service filters). Drives
 * the empty state when the selected fuel isn't sold at all — E10 and E85
 * barely exist outside France (nowhere in Andorra, a handful of Spanish
 * stations), so an empty map must say so instead of looking broken.
 */
export const selectZoneFuels = cached((app: AppStore): FuelId[] => {
  // Raw prices only — a fuel reachable through the SP95 fallback is not
  // « sold here », the chip must name what the pumps actually serve. One
  // pass collecting the fuels on offer, not one filtered pass per fuel.
  const sold = new Set<FuelId>();
  for (const s of selectZoneStations(app)) {
    for (const f of ALL_FUELS) if (s.prices[f] != null) sold.add(f);
  }
  return ALL_FUELS.filter((f) => sold.has(f));
});

/**
 * Stations drawn on the map: every loaded station passing the fuel/brand/
 * service filters, NOT limited to the radius circle. Restricting pins to the
 * radius makes them pop in and out while panning; the circle stays a visual
 * indicator of the « cheapest near you » zone.
 */
export const selectMapStations = cached((app: AppStore): NearbyStation[] =>
  selectTagged(app).filter((s) => effectivePrice(s, app.fuel) != null && passesBrand(app, s)),
);

/**
 * Zone stations cheapest-first. Prices are DISPLAYED at cent precision while
 * the feeds carry tenths of a cent (1,896 vs 1,904 both read « 1,90 €»), so
 * the ranking works in cents too: at the same displayed price the NEAREST
 * station comes first — the recommended pump must never be a farther one
 * for a difference the user cannot even see.
 */
export const selectByPrice = cached((app: AppStore): NearbyStation[] => {
  const f = app.fuel;
  const cents = (s: NearbyStation) => priceCents(effectivePrice(s, f)?.value ?? 9);
  return [...selectVisible(app)].sort((a, b) => cents(a) - cents(b) || a.distKm - b.distKm);
});

export const selectSorted = cached((app: AppStore): NearbyStation[] =>
  app.sort === 'price'
    ? selectByPrice(app)
    : [...selectVisible(app)].sort((a, b) => a.distKm - b.distKm),
);

/** Cheapest STICKER price of the zone — labels (« meilleur prix ») and deltas */
export function selectCheapest(app: AppStore): NearbyStation | null {
  return selectByPrice(app)[0] ?? null;
}

// effectiveLiterPrice (imported above, re-exported): the per-litre price with
// the trip to the pump folded in — shared with the route optimizer's economics
// module so the map view and the route plan value a detour the same way.

// ── Favoris sorting ──────────────────────────────────────────────────────────
export type FavSort = 'recommended' | 'price' | 'distance';

/**
 * Order the Favoris rows. « Recommandé » ranks on the effective per-litre
 * price (fuel burnt to get there included — same notion as the map card);
 * « Prix » keeps the raw sticker order; rows without a live price (area not
 * loaded) always sink to the bottom, sorted by distance.
 */
export function sortFavoriteRows<T extends { price: number | null; distKm: number }>(
  rows: T[],
  sort: FavSort,
  app: Pick<AppStore, 'consumption' | 'tank'>,
): T[] {
  return [...rows].sort((a, b) => {
    if (sort === 'distance') return a.distKm - b.distKm;
    if (sort === 'price') {
      if (a.price == null && b.price == null) return a.distKm - b.distKm;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return a.price - b.price;
    }
    const ea = a.price != null ? effectiveLiterPrice(app, a.price, a.distKm) : Infinity;
    const eb = b.price != null ? effectiveLiterPrice(app, b.price, b.distKm) : Infinity;
    if (ea === eb) return a.distKm - b.distKm;
    return ea - eb;
  });
}

/**
 * Effective prices within this margin (cents) count as equal — feeds go
 * stale for days and distances are only estimated until the road matrix
 * lands, a cent of effective gap is noise, not a reason to drive farther.
 */
const RECO_TIE_CENTS = 1;

/**
 * Station crowned by the collapsed sheet card: the best DEAL, not the best
 * sticker price. Ranked on the effective per-litre price — a station a few
 * cents dearer but several km closer wins when the longer drive burns more
 * than it saves. Effective prices within RECO_TIE_CENTS are a tie and the
 * NEAREST tied station is picked, which also preserves selectByPrice's rule
 * that the recommendation never sends the user farther for a price
 * difference they cannot even see.
 */
export const selectRecommended = cached((app: AppStore): NearbyStation | null => {
  const f = app.fuel;
  const zone = selectVisible(app);
  const eff = (s: NearbyStation) =>
    priceCents(effectiveLiterPrice(app, effectivePrice(s, f)!.value, s.distKm));
  let min = Infinity;
  for (const s of zone) min = Math.min(min, eff(s));
  let pick: NearbyStation | null = null;
  for (const s of zone) {
    if (eff(s) - min <= RECO_TIE_CENTS && (!pick || s.distKm < pick.distKm)) pick = s;
  }
  return pick;
});

/**
 * Station currently selected on the map (pin tapped / list row tapped).
 * Resolved against the map pins so a station outside the radius circle can
 * still be selected; null when the selection no longer matches the filters.
 */
export const selectFocusStation = cached((app: AppStore): NearbyStation | null => {
  if (!app.focusStationId) return null;
  return selectMapStations(app).find((s) => s.id === app.focusStationId) ?? null;
});

// ── Price tiers: « bons plans » vs stations chères ───────────────────────────
/**
 * The feeds carry tenths of a cent but the UI displays cents — every price
 * comparison shown to the user (ranking, tiers, deltas) works on this
 * rounding, so two stations reading the same price always behave the same.
 */
export function priceCents(v: number): number {
  return Math.round(v * 100);
}

/** Prices within this margin of the extremes always share their tier (€/L) */
const TIER_EPS = 0.01;
/** Share of the min→mean (resp. mean→max) gap folded into the extreme tiers */
const TIER_SPREAD = 0.25;

export type PriceTier = 'deal' | 'mid' | 'high';

export interface PriceStats {
  min: number;
  max: number;
  mean: number;
  /** Upper price bound of the « bon plan » tier */
  dealMax: number;
  /** Lower price bound of the expensive tier */
  highMin: number;
  /**
   * « Bon plan » floor for stations INSIDE the circle: the zone's cheapest
   * and its near-identical peers (± 1 ct) stay green even when the wider
   * loaded area hides a cheaper pump elsewhere. Null when the circle is
   * empty. Only in-zone stations use it, so a sparse circle still can't
   * repaint the rest of the map. The RECOMMENDED station (best effective
   * price — its sticker price can sit well above the minimum) is greened
   * individually by the map and the list, NOT via this bound: raising the
   * zone threshold to its price would turn most of the zone green.
   */
  zoneDealMax: number | null;
}

/**
 * Price distribution tiering the pins, dots and list rows for the selected
 * fuel. Computed over ALL the stations drawn on the map (the whole loaded
 * area) — the same population the tiers color — NOT just the radius circle:
 * scoping the scale to the circle while coloring the whole map made a sparse
 * circle degenerate the bounds (one lone station in the circle → everything
 * on screen ≤ its price + 1 ct turned green), so a small pan flipped pins
 * between red and green a few centimeters apart.
 * The tier bounds adapt to the spread: a station is a « bon plan » when its
 * price sits within 1 ct of the cheapest — widened to a quarter of the
 * cheapest→average gap when prices are spread out — so SEVERAL stations at
 * near-identical low prices are all highlighted, not just the first one.
 * Symmetrically, prices hugging the maximum form the expensive tier.
 */
export const selectPriceStats = cached((app: AppStore): PriceStats | null => {
  const f = app.fuel;
  const pins = selectMapStations(app);
  if (!pins.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const s of pins) {
    const p = effectivePrice(s, f)!.value;
    if (p < min) min = p;
    if (p > max) max = p;
    sum += p;
  }
  const mean = sum / pins.length;
  let zoneMin = Infinity;
  for (const s of selectVisible(app)) {
    const p = effectivePrice(s, f)!.value;
    if (p < zoneMin) zoneMin = p;
  }
  return {
    min,
    max,
    mean,
    dealMax: min + Math.max(TIER_EPS, TIER_SPREAD * (mean - min)),
    highMin: max - Math.max(TIER_EPS, TIER_SPREAD * (max - mean)),
    zoneDealMax: zoneMin === Infinity ? null : zoneMin + TIER_EPS,
  };
});

/**
 * Tier of a price against the area distribution — colors pins, dots and rows.
 * `inZone` (station inside the search circle) unlocks the zone floor: the
 * circle's cheapest and its ± 1 ct peers are « bons plans » even when the
 * wider loaded area is cheaper somewhere else.
 */
export function priceTier(price: number, stats: PriceStats | null, inZone = false): PriceTier {
  if (!stats) return 'mid';
  const dealMax =
    inZone && stats.zoneDealMax != null ? Math.max(stats.dealMax, stats.zoneDealMax) : stats.dealMax;
  // Tier at DISPLAYED precision: a raw threshold falling inside a cent must
  // not split two stations both reading « 1,90 € » into green and gray
  if (priceCents(price) <= priceCents(dealMax)) return 'deal';
  // A tight area can make the two bounds overlap — being a bon plan wins
  if (priceCents(price) >= priceCents(stats.highMin) && stats.highMin > stats.dealMax)
    return 'high';
  return 'mid';
}

/** Zone stations in the « bon plan » tier, cheapest first */
export const selectDeals = cached((app: AppStore): NearbyStation[] => {
  // The distribution is shared with whoever already asked for it this render
  const stats = selectPriceStats(app);
  if (!stats) return [];
  const f = app.fuel;
  return selectByPrice(app).filter(
    (s) => priceTier(effectivePrice(s, f)!.value, stats, true) === 'deal',
  );
});

export const selectPriceRange = cached((app: AppStore): { min: number; max: number } | null => {
  const f = app.fuel;
  const zone = selectVisible(app);
  if (!zone.length) return null;
  // True extremes of the raw prices — selectByPrice ranks in cents with a
  // distance tie-break, so its first/last are not the exact min/max anymore
  let min = Infinity;
  let max = -Infinity;
  for (const s of zone) {
    const p = effectivePrice(s, f)!.value;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
});

export interface ZoneDelta {
  /** €/L, never negative — the sign the card prints comes from `best` */
  amount: number;
  /**
   * true: the station IS the circle's cheapest, `amount` is the zone spread
   * it saves against the priciest pump around (« −0,20 €/L »); false:
   * `amount` is what it costs MORE than the circle's cheapest (« +0,05 €/L »).
   */
  best: boolean;
}

/**
 * « vs the zone » figure of the sheet card, compared at DISPLAYED precision
 * (what the user reads is price shown − min shown, never a tenth-of-a-cent
 * artifact off by one).
 *
 * Null when there is nothing to compare against, and the card must then say
 * nothing: an EMPTY circle (a selected pin keeps its card even when the
 * radius holds no station — pins are not radius-limited, see
 * selectMapStations) or a station selected OUTSIDE the circle, which has no
 * « zone » to be cheap or dear in either.
 */
export function selectZoneDelta(app: AppStore, station: NearbyStation | null): ZoneDelta | null {
  if (!station) return null;
  const range = selectPriceRange(app);
  if (!range || station.searchKm > app.radius) return null;
  const min = priceCents(range.min);
  if (selectCheapest(app)?.id === station.id) {
    return { amount: (priceCents(range.max) - min) / 100, best: true };
  }
  const price = effectivePrice(station, app.fuel)?.value ?? 0;
  return { amount: (priceCents(price) - min) / 100, best: false };
}

/** Autonomy narrative for the route ribbon (depends on tank setting) */
export function selectAutonomy(app: AppStore): { autonomyKm: number; limitKm: number } {
  const startFuel = (app.tank * app.startTankPct) / 100;
  const autonomyKm = Math.round((startFuel / app.consumption) * 100);
  // The explicit reserve function draws the "you must stop" line
  const limitKm = Math.round(usableRangeKm(startFuel, app.consumption) / 10) * 10;
  return { autonomyKm, limitKm };
}

/** Arrival narrative of the ribbon's last row, as data */
export type ArrivalEstimate =
  /** Arrival at `at` (epoch ms) once `stops` refuelling stops are folded in */
  | { kind: 'withStops'; stops: number; at: number; extraMin: number }
  /** The tank cannot make it without stopping */
  | { kind: 'autonomyShort'; limitKm: number }
  | { kind: 'direct'; at: number };

/**
 * Candidate stations of the current route plan — the bounded, geographically
 * distributed subset one matrix call can measure (lib/routeCandidates).
 */
export const selectPlanCandidates = cached((app: AppStore): RouteCandidate[] =>
  planCandidatesFor(
    app.routeState,
    app.fuel,
    { tank: app.tank, consumption: app.consumption, startTankPct: app.startTankPct },
    app.plannedStops,
    getProviders(app.routeState.fellBack ? 'demo' : app.sourceId).route.travelMatrixMaxPoints,
  ),
);

/**
 * Road legs the plan runs on: the fetched matrix when it matches the current
 * candidate set, the geometric estimate otherwise (loading, failure, provider
 * without a matrix backend). The quality flag rides along.
 */
const selectPlanLegs = cached((app: AppStore): PlanLegs | null => {
  const route = app.routeState.route;
  if (app.routeState.status !== 'ready' || !route) return null;
  const candidates = selectPlanCandidates(app);
  const { routeMatrix } = app;
  if (routeMatrix.status === 'ready' && routeMatrix.cells && app.fromPoint && app.toPoint) {
    const key = travelMatrixKey(
      app.routeState.fellBack ? 'demo' : app.sourceId,
      app.fromPoint,
      app.toPoint,
      candidates,
      { avoidMotorway: app.avoidMotorway, avoidToll: app.avoidToll, vehicle: app.vehicle },
    );
    if (key === routeMatrix.key) {
      const legs = matrixPlanLegs(routeMatrix.cells, candidates.length, route);
      if (legs) return legs;
    }
  }
  return estimatePlanLegs(route, candidates);
});

/**
 * THE fuel-stop plan — pure solve over the candidate graph (lib/routeOptimizer):
 * the store only assembles immutable inputs, the algorithm lives outside it.
 * User-picked stops (plannedStops) are constrained INTO the plan; the ones the
 * optimizer cannot place (no price for the fuel, off the corridor) surface in
 * `selectRouteAnalysis().invalidPlannedStopIds` instead of being ignored.
 */
export const selectRoutePlan = cached((app: AppStore): RoutePlan | null => {
  const route = app.routeState.route;
  const legs = selectPlanLegs(app);
  if (!route || !legs) return null;
  const candidates = selectPlanCandidates(app);
  const candidateIds = new Set(candidates.map((c) => c.station.id));
  const required = Object.keys(app.plannedStops).filter(
    (id) => app.plannedStops[id] && candidateIds.has(id),
  );
  return planRoute({
    stations: candidates.map((c) => ({
      id: c.station.id,
      positionKm: c.projectionKm,
      priceMilli: c.priceMilli,
      priceUpdatedAt: c.priceUpdatedAt,
    })),
    direct: legs.direct,
    originLegs: legs.origin,
    destinationLegs: legs.destination,
    stationLegs: legs.between,
    tankLitres: app.tank,
    consumptionLitresPer100Km: app.consumption,
    startFuelLitres: (app.tank * app.startTankPct) / 100,
    strategy: app.routeMode,
    requiredStationIds: required,
    quality: legs.quality,
  });
});

/** One plan stop resolved to its display station */
export interface PlanStopView {
  station: RouteStation;
  stop: PlannedFuelStop;
}

export interface RouteAnalysis {
  /** The computed plan (null while no route is ready) */
  plan: RoutePlan | null;
  /** Plan stops in driving order, resolved to their stations */
  planStops: PlanStopView[];
  /** Cheapest candidates OUTSIDE the plan, km order — browsing, never « the » plan */
  alternatives: RouteStation[];
  limitKm: number;
  autonomyKm: number;
  needsStop: boolean;
  arrival: ArrivalEstimate | null;
  /** Stops the user picked by hand (feed the multi-stop Maps run) */
  plannedStops: RouteStation[];
  /** User picks the optimizer could not place (no usable price / off corridor) */
  invalidPlannedStopIds: string[];
  /** Σ litres to buy across the plan */
  purchaseLitres: number | null;
  /** Σ purchases, integer cents — the only cash figure of the trip */
  purchaseCostCents: number | null;
  destinationFuelLitres: number | null;
  /** routed = matrix legs; estimated = geometric fallback (say so in the UI) */
  quality: PlanQuality | null;
}

/** Number of alternative stations offered around the plan */
const MAX_ALTERNATIVES = 4;

/** Everything the route ribbon needs, computed from real data */
export function selectRouteAnalysis(app: AppStore): RouteAnalysis {
  const { routeState } = app;
  const { limitKm, autonomyKm } = selectAutonomy(app);
  const route = routeState.route;
  const plan = selectRoutePlan(app);
  const candidates = selectPlanCandidates(app);
  const byId = new Map(routeState.stations.map((s) => [s.id, s] as const));

  const planStops: PlanStopView[] = [];
  if (plan) {
    for (const stop of plan.stops) {
      const station = byId.get(stop.stationId);
      if (station) planStops.push({ station, stop });
    }
  }
  const planIds = new Set(plan?.stops.map((s) => s.stationId) ?? []);
  const alternatives = candidates
    .filter((c) => !planIds.has(c.station.id))
    .sort((a, b) => a.priceMilli - b.priceMilli || (a.station.id < b.station.id ? -1 : 1))
    .slice(0, MAX_ALTERNATIVES)
    .map((c) => c.station)
    .sort((a, b) => a.kmAlong - b.kmAlong);

  const picked = routeState.stations.filter((s) => app.plannedStops[s.id]);
  const candidateIds = new Set(candidates.map((c) => c.station.id));
  const invalidPlannedStopIds = picked
    .map((s) => s.id)
    .filter((id) => !candidateIds.has(id));

  const needsStop = plan ? plan.status !== 'direct' : !!route && route.distanceKm > limitKm;

  let arrival: ArrivalEstimate | null = null;
  if (route && plan) {
    if (plan.status === 'planned') {
      arrival = {
        kind: 'withStops',
        stops: plan.stops.length,
        at: Date.now() + (route.durationMin + plan.extraDurationMin) * 60000,
        extraMin: Math.round(plan.extraDurationMin),
      };
    } else if (plan.status === 'infeasible') {
      arrival = { kind: 'autonomyShort', limitKm };
    } else {
      arrival = { kind: 'direct', at: Date.now() + route.durationMin * 60000 };
    }
  }

  return {
    plan,
    planStops,
    alternatives,
    limitKm,
    autonomyKm,
    needsStop,
    arrival,
    plannedStops: picked,
    invalidPlannedStopIds,
    purchaseLitres: plan ? plan.stops.reduce((a, s) => a + s.purchasedLitres, 0) : null,
    purchaseCostCents: plan ? plan.totalPurchaseCostCents : null,
    destinationFuelLitres: plan ? plan.destinationFuelLitres : null,
    quality: plan?.quality ?? null,
  };
}
