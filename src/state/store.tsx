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
import {
  loadPersisted,
  savePersisted,
  type FavoriteStation,
  type MapsSiteId,
  type PersistedSettings,
  type SearchedPlace,
} from './persist';
import { pushSearchIn } from './searchHistory';
import { beginRouteTiming, markRoute } from '../lib/perf';
import {
  CROW_ROAD_FACTOR,
  VALUE_OF_TIME_CENTS_PER_MIN,
  effectiveLiterPrice,
  usableRangeKm,
} from '../lib/fuelEconomics';
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
  beginCorridor,
  beginGeometry,
  beginMatrix,
  commitCorridor,
  commitGeometry,
  commitMatrix,
  failCorridor,
  failGeometry,
  failMatrix,
  initialRouteState,
  matrixBlocked,
  routeKey,
  travelMatrixKey,
  type RouteEndpoints,
  type RouteState,
} from './routePipeline';
import { mapUrlQuery, parseMapUrl } from '../lib/mapUrl';
import {
  coordinateLabel,
  parseRouteUrl,
  routeScreenFromUrl,
  routeUrlQuery,
  type RouteUrlView,
} from '../lib/routeUrl';
import {
  mapViewShareData,
  routeShareData,
  stationShareData,
  type ShareData,
} from '../lib/share';
import {
  collectCachedStations,
  readStationsCache,
  writeStationsCache,
  STALE_MS,
} from '../data/stationsCache';
import {
  planFavoriteRefresh,
  pruneFavoritePrices,
  readFavoritePrices,
  recordFavoritePrices,
  type FavoritePriceEntry,
} from '../data/favoritePrices';
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
 * destination. This is OUR budget, not a backend limit — 32 keeps the request
 * small while covering ~30 stations, plenty for one corridor, and it is what
 * binds today since every provider declares a higher `travelMatrixMaxPoints`.
 * The min against that value is the guard for a provider that declares less.
 */
const MATRIX_MAX_POINTS = 32;
/**
 * Quiet period before the matrix call goes out. Long enough that dragging the
 * departure-tank slider — which re-thins the candidate set at every step —
 * issues one request when it settles instead of one per step.
 */
const MATRIX_DEBOUNCE_MS = 350;
/** Extra tries after a failed matrix call (429s from public servers are transient) */
const MATRIX_RETRIES = 2;
/** First retry gap; each further one doubles it */
const MATRIX_RETRY_BASE_MS = 1200;
// Shared fuel-economics constants live in lib/fuelEconomics — re-exported so
// existing imports (tests, screens) keep one canonical source. travelMatrixKey
// is the pipeline's (re-exported for the selector tests).
export { CROW_ROAD_FACTOR, effectiveLiterPrice, travelMatrixKey };
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

/**
 * Zone list order. « Recommandé » (the default, like the Favoris) ranks on
 * the effective per-litre price — see `effectiveLiterPrice`; « Prix » on the
 * sticker; « Distance » on the road distance.
 */
export type SortMode = 'recommended' | 'price' | 'distance';

/**
 * Which search field is open. Being open is nav state (the phone search is a
 * screen, the system Back closes it), and with three fields in the app the
 * entry has to say WHICH one — the map's area search, or one of the route's
 * two endpoint fields.
 */
export type SearchTarget = 'area' | 'routeFrom' | 'routeTo';

export type { MapsSiteId, FavoriteStation, SearchedPlace };
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

/** Why the last stations fetch failed. `offline` only when the browser is
 *  positive about it (`navigator.onLine === false`) — anything else is blamed
 *  on the source, because `onLine === true` proves nothing (captive portals). */
export type StationsErrorKind = 'offline' | 'source';

export interface StationsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: Station[];
  /** Source that served the data currently on screen */
  activeSource: DataSourceId;
  /** Standing failure: the last fetch attempt failed and no success has
   *  cleared it yet. The data shown (if any) is kept, only flagged. */
  lastError?: StationsErrorKind;
  /** When the shown data was fetched from the source (cache or live) */
  fetchedAt?: number;
  /** true while shown data stays put and a background attempt is running */
  refreshing: boolean;
}

export type { RouteState };

/** Candidate stations of the current route plan — pure, shared by the matrix
    effect and the selectors so both always describe the same set. A plan
    stands as long as a corridor stands: `stations` may be the previous key's
    while a recompute runs, and the plan keeps describing them. */
function planCandidatesFor(
  routeState: RouteState,
  fuel: FuelId,
  vehicle: { tank: number; consumption: number; startTankPct: number },
  plannedStops: Record<string, boolean>,
  matrixMaxPoints: number | undefined,
): RouteCandidate[] {
  const route = routeState.route;
  if (!route || routeState.stations.length === 0) return [];
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

/** One step of the stations state machine — dispatched by `loadStations` */
export type StationsEvent =
  | {
      kind: 'cache';
      data: Station[];
      source: DataSourceId;
      fetchedAt: number;
      /** true when a live fetch follows right behind the paint */
      revalidating: boolean;
    }
  | {
      kind: 'request';
      /** The browser says offline: with data on screen the doomed attempt
       *  runs as a background refresh, so nothing visibly resets. */
      offlineHint: boolean;
    }
  | { kind: 'success'; data: Station[]; source: DataSourceId; fetchedAt: number }
  | { kind: 'failure'; source: DataSourceId; error: StationsErrorKind };

/**
 * Stations state machine. The invariant every transition protects: real data
 * on screen STAYS on screen. A failure flags the state (`lastError`) instead
 * of substituting anything — the demo dataset is a source the user selects,
 * never a fallback — and `status: 'loading'` is reserved for "nothing worth
 * painting yet".
 */
export function nextStationsState(prev: StationsState, ev: StationsEvent): StationsState {
  switch (ev.kind) {
    case 'cache':
      // Painting from cache says nothing about connectivity: a standing
      // failure notice survives until a live fetch succeeds again.
      return {
        status: 'ready',
        data: ev.data,
        activeSource: ev.source,
        lastError: prev.lastError,
        fetchedAt: ev.fetchedAt,
        refreshing: ev.revalidating,
      };
    case 'request':
      if (ev.offlineHint && prev.data.length > 0) return { ...prev, refreshing: true };
      return { ...prev, status: 'loading', refreshing: false };
    case 'success':
      return {
        status: 'ready',
        data: ev.data,
        activeSource: ev.source,
        fetchedAt: ev.fetchedAt,
        refreshing: false,
      };
    case 'failure': {
      // Keep what is on screen — unless it belongs to another source: after a
      // source switch, the previous source's stations must not pass for the
      // new one's.
      if (prev.data.length > 0 && prev.activeSource === ev.source) {
        return { ...prev, status: 'ready', refreshing: false, lastError: ev.error };
      }
      return {
        status: 'error',
        data: [],
        activeSource: ev.source,
        refreshing: false,
        lastError: ev.error,
      };
    }
  }
}

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
  /** Which search field is open, null when none. A nav state like the
      filters sheet: opening one stacks a history entry, so the system Back
      closes it — on a phone the search takes the whole screen, and Back is
      how a screen is left. */
  searchOpen: SearchTarget | null;
  setSearchOpen(target: SearchTarget | null): void;
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
  /** Last known prices per favorite id, from the compact favorite-price
      store — what the Favoris rows fall back to when the live area doesn't
      cover them. Refreshed when the tab opens. */
  favoritePrices: Record<string, FavoritePriceEntry>;

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
  /** Places looked up and picked — in the map's search or a route field —
      offered back by every search field */
  searchHistory: SearchedPlace[];
  rememberSearchedPlace(place: GeocodeResult): void;
  routeReady: boolean;
  /** Submit the trip. `toPick` carries a destination picked this same tick
      (auto-start on pick), before React has committed it to `toText`. */
  startRoute(toPick?: GeocodeResult): void;
  /** true while the submitted addresses are being geocoded, before navigating */
  geocoding: boolean;
  editRoute(): void;
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
  /** Re-run both stages for the current endpoints */
  retryRoute(): void;
  /** Re-run only the corridor stage, against the already-committed geometry */
  retryCorridor(): void;
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
  /** Share the trip as it stands — same link the address bar carries */
  shareRoute(): void;

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
      return '/route';
    // The ribbon owns its own path, so the URL alone can rebuild the right
    // screen — a « Ma position » trip carries no departure in its query, and
    // the query's completeness could not tell the two screens apart.
    case 'route':
      return '/route/results';
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
  if (path.startsWith('/route')) {
    return {
      screen: path.startsWith('/route/results') ? 'route' : 'routeSetup',
      detailId: null,
    };
  }
  if (path.startsWith('/settings')) return { screen: 'settings', detailId: null };
  if (path.startsWith('/station/')) {
    // Bookmarks predating the `fra-` prefix still carry a bare French id
    const id = normalizeStationId(decodeURIComponent(path.slice('/station/'.length)));
    return { screen: 'detail', detailId: id };
  }
  return { screen: 'map', detailId: null };
}

/** What the app stores in `history.state` for each of its own entries */
export type NavHistoryState = {
  plein?: boolean;
  screen?: Screen;
  detailId?: string | null;
  filtersOpen?: boolean;
  /** Which search field the entry holds open — entries written before the
      route shared the search carried a boolean, hence the union */
  searchOpen?: SearchTarget | boolean | null;
  /** 0 = the entry the app was opened on (nothing of ours to pop below it) */
  idx?: number;
};

/** Search target of a stored entry — legacy booleans mean the map's field */
export function navSearchTarget(st: NavHistoryState | null): SearchTarget | null {
  if (!st) return null;
  if (typeof st.searchOpen === 'string') return st.searchOpen;
  return st.searchOpen === true ? 'area' : null;
}

/**
 * Whether moving to `next` swaps one fiche for another. On screen this reads
 * as a swap — the panel changes station in place, the map and the list stay
 * put — so it swaps the history entry too. Stacking one entry per station
 * compared would make ✕ (and Back) walk every fiche read instead of closing
 * the panel.
 */
export function isFicheSwap(
  cur: NavHistoryState | null,
  next: { screen: Screen; detailId: string | null; filtersOpen: boolean },
): boolean {
  return (
    !!cur?.plein &&
    cur.screen === 'detail' &&
    next.screen === 'detail' &&
    (cur.detailId ?? null) !== next.detailId &&
    // The filters sheet owns its own entry (Back closes it) — a fiche swap
    // that also opens or closes it is not just a swap.
    !!cur.filtersOpen === next.filtersOpen
  );
}

const Ctx = createContext<AppStore | null>(null);

// ── Provider component ───────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useRef(loadPersisted()).current;

  const pathNav = navFromPath(window.location.pathname);
  const onRoutePath = pathNav.screen === 'route' || pathNav.screen === 'routeSetup';
  // A shared route link (`/route/results?d=…&f=…`) seeds the trip the same
  // way a map link seeds the view — and its completeness decides which route
  // screen actually opens: a half-specified link degrades to the setup form
  // pre-filled, never to an error.
  const initialRoute = useRef(parseRouteUrl(onRoutePath ? window.location.search : '')).current;
  const initialNav = {
    screen: onRoutePath
      ? routeScreenFromUrl(pathNav.screen === 'route', initialRoute)
      : pathNav.screen,
    detailId: pathNav.detailId,
  };
  // A link followed by someone who hasn't onboarded yet: the walkthrough comes
  // first, so the destination is parked here and restored when it ends.
  const pendingNav = useRef(persisted.onboarded ? null : initialNav);
  // A shared map link (`/?ll=…&z=…&f=…&r=…`) wins over the persisted settings:
  // whoever opens it must see the view that was shared, not their own. `f` is
  // the same key with the same legacy migration on both screens, so a route
  // link's fuel seeds through here too.
  const initialMap = useRef(parseMapUrl(window.location.search)).current;
  const [screen, setScreen] = useState<Screen>(
    persisted.onboarded ? initialNav.screen : 'onboarding',
  );
  const [prevScreen, setPrevScreen] = useState<Screen>('map');
  const [fuel, setFuel] = useState<FuelId>(initialMap.fuel ?? persisted.fuel ?? 'diesel');
  usePersisted('fuel', fuel);
  const [sort, setSort] = useState<SortMode>('recommended');
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
    Object.fromEntries((initialMap.services ?? persisted.serviceTags ?? []).map((t) => [t, true])),
  );
  // The selection as the URL and the settings blob spell it: the active tags
  // in the canonical order, so a shared link and a reload both come back to
  // the same filters (`brandSel` has worked that way since it existed).
  const activeServiceTags = useMemo(
    () => SERVICE_TAGS.filter((t) => serviceTags[t]),
    [serviceTags],
  );
  usePersisted('serviceTags', activeServiceTags);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState<SearchTarget | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>(initialRoute.mode ?? 'balanced');
  const [plannedStops, setPlannedStops] = useState<Record<string, boolean>>({});
  const [detailId, setDetailId] = useState<string | null>(
    persisted.onboarded ? initialNav.detailId : null,
  );
  // Endpoints seeded from the link: a label displays as itself, coordinates
  // without one display as coordinates — either alone is enough (a bare label
  // geocodes through the path `startRoute` already takes).
  const [fromText, setFromText] = useState(
    () =>
      initialRoute.fromLabel ??
      (initialRoute.fromPoint ? coordinateLabel(initialRoute.fromPoint) : ''),
  );
  // The departure defaults to « wherever I am ». It is a state flag, not a
  // string compared against a label: a translated label would silently stop
  // matching and the app would try to geocode the words « My position ».
  const [fromIsCurrentPosition, setFromIsCurrentPosition] = useState(
    initialRoute.fromLabel == null && initialRoute.fromPoint == null,
  );
  const [toText, setToText] = useState(
    () =>
      initialRoute.toLabel ??
      (initialRoute.toPoint ? coordinateLabel(initialRoute.toPoint) : ''),
  );
  const [fromPoint, setFromPoint] = useState<GeoPoint | null>(initialRoute.fromPoint);
  const [toPoint, setToPoint] = useState<GeoPoint | null>(initialRoute.toPoint);
  // A ribbon link whose endpoints need no geocoding is ready from the first
  // frame: the screen opens on the awaited-trip skeleton, not on a flash of
  // the setup form, while the auto-started compute runs.
  const [routeReady, setRouteReady] = useState(
    initialNav.screen === 'route' &&
      initialRoute.toPoint != null &&
      (initialRoute.fromPoint != null || initialRoute.fromLabel == null),
  );
  // The link's vehicle assumptions win over the persisted profile but are
  // never written back to it: opening someone else's trip must not silently
  // rewrite the reader's own vehicle (the setters below persist on user
  // action only).
  const [vehicle, setVehicleState] = useState<VehicleId>(
    initialRoute.vehicle ?? persisted.vehicle ?? 'car',
  );
  const [tank, setTankState] = useState<number>(
    initialRoute.tank ?? persisted.tank ?? VEHICLE_PRESETS.car.tank,
  );
  const [consumption, setConsumptionState] = useState<number>(
    initialRoute.consumption ?? persisted.consumption ?? DEFAULT_CONSUMPTION,
  );
  // A link that names a trip decides the avoids too — `x` absent means OFF,
  // or the reader's own « éviter les péages » would silently reroute the
  // shared trip.
  const linkNamesTrip = initialRoute.toPoint != null || initialRoute.toLabel != null;
  const [avoidMotorway, setAvoidMotorwayState] = useState<boolean>(
    linkNamesTrip ? (initialRoute.avoidMotorway ?? false) : (persisted.avoidMotorway ?? false),
  );
  const [avoidToll, setAvoidTollState] = useState<boolean>(
    linkNamesTrip ? (initialRoute.avoidToll ?? false) : (persisted.avoidToll ?? false),
  );
  const [startTankPct, setStartTankPctState] = useState<number>(
    initialRoute.startTankPct ?? persisted.startTankPct ?? DEFAULT_START_TANK_PCT,
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
  // The id set the opportunistic price capture reads — a ref, so a fetch
  // landing mid-render records against the current list without retriggering
  // loadStations. The compact store follows the list: unstarring prunes.
  const favoriteIds = useRef<Set<string>>(new Set(favorites.map((f) => f.id)));
  useEffect(() => {
    favoriteIds.current = new Set(favorites.map((f) => f.id));
    pruneFavoritePrices(favoriteIds.current);
  }, [favorites]);
  const [favoritePrices, setFavoritePrices] = useState<Record<string, FavoritePriceEntry>>({});
  const favPricesReq = useRef(0);
  /** When each favorite was last refreshed by the Favoris tab this session —
      a station absent from its own zone must not be re-fetched in a loop */
  const favRefreshAttempted = useRef(new Map<string, number>());
  // Pull-up hint on the map sheet: armed when onboarding ends, spent as soon
  // as it plays (persisted, so quitting before the stations land keeps it)
  const [sheetHint, setSheetHint] = useState<boolean>(persisted.sheetHint ?? false);
  const consumeSheetHint = useCallback(() => {
    setSheetHint(false);
    savePersisted({ sheetHint: false });
  }, []);

  // The one place history of the app — the map's search and the two route
  // fields all feed and read it (persist.ts folds the retired trip
  // « Récents » into it on the way in).
  const [searchHistory, setSearchHistory] = useState<SearchedPlace[]>(
    persisted.searchHistory ?? [],
  );
  usePersisted('searchHistory', searchHistory);
  const rememberSearchedPlace = useCallback((place: GeocodeResult) => {
    const at = Date.now();
    setSearchHistory((prev) => pushSearchIn(prev, place, at));
  }, []);
  const [canInstall, setCanInstall] = useState(installReady());
  const [installDismissed, setInstallDismissed] = useState(persisted.installDismissed ?? false);
  const [stations, setStations] = useState<StationsState>({
    status: 'idle',
    data: [],
    activeSource: sourceId,
    refreshing: false,
  });
  const [routeState, setRouteState] = useState<RouteState>(initialRouteState);
  const [geocoding, setGeocoding] = useState(false);
  const startingRef = useRef(false);

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
      const st = e.state as NavHistoryState | null;
      popNavRef.current = true;
      if (st?.plein && st.screen) {
        setScreen(st.screen);
        setDetailId(st.detailId ?? null);
        setFiltersOpen(!!st.filtersOpen);
        setSearchOpen(navSearchTarget(st));
      } else {
        const nav = navFromPath(window.location.pathname);
        setScreen(nav.screen);
        setDetailId(nav.detailId);
        setFiltersOpen(false);
        setSearchOpen(null);
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
        services: activeServiceTags,
      }),
    [searchPos, mapZoom, fuel, radius, brandSel, activeServiceTags],
  );
  // The trip + its assumptions, as they appear in the URL and in a share —
  // one view feeds both, so the share action produces exactly the link the
  // address bar shows. Route params change on user input, not several times
  // a second: the shared throttle below is a no-op here, but costs nothing.
  const routeView = useMemo<RouteUrlView>(
    () => ({
      fromPoint,
      fromLabel: fromIsCurrentPosition ? '' : fromText,
      fromIsCurrentPosition,
      toPoint,
      toLabel: toText,
      fuel,
      mode: routeMode,
      vehicle,
      tank,
      consumption,
      startTankPct,
      avoidMotorway,
      avoidToll,
    }),
    [
      avoidMotorway, avoidToll, consumption, fromIsCurrentPosition, fromPoint, fromText, fuel,
      routeMode, startTankPct, tank, toPoint, toText, vehicle,
    ],
  );
  const routeQuery = useMemo(() => routeUrlQuery(routeView), [routeView]);
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
      !!cur.filtersOpen === filtersOpen &&
      navSearchTarget(cur) === searchOpen;
    const url =
      pathFor(screen, detailId) +
      (screen === 'map'
        ? mapQuery
        : screen === 'route' || screen === 'routeSetup'
          ? routeQuery
          : '');
    if (sameNav && url === window.location.pathname + window.location.search) return;
    // Swapping one open search field for another (departure ↔ arrival) reads
    // as a swap on screen, so it swaps the entry too — Back must close the
    // search, not walk every field it filled.
    const searchSwap =
      !!cur?.plein &&
      cur.screen === screen &&
      navSearchTarget(cur) != null &&
      searchOpen != null &&
      navSearchTarget(cur) !== searchOpen;
    // First entry — and leaving onboarding must not be back-navigable
    const replace =
      !cur?.plein ||
      cameFrom === 'onboarding' ||
      replaceAsked ||
      sameNav ||
      searchSwap ||
      isFicheSwap(cur, { screen, detailId, filtersOpen });
    // How deep the app is in ITS OWN history: entry 0 is the one the app was
    // opened on, and popping it would leave the app entirely.
    const idx = replace ? (cur?.plein ? (cur.idx ?? 0) : 0) : (cur?.idx ?? 0) + 1;
    const state: NavHistoryState = {
      plein: true,
      screen,
      detailId,
      filtersOpen,
      searchOpen,
      idx,
    };
    const write = () => {
      urlWrite.current.at = Date.now();
      if (replace) window.history.replaceState(state, '', url);
      else window.history.pushState(state, '', url);
    };
    const wait = sameNav ? MAP_URL_MIN_MS - (Date.now() - urlWrite.current.at) : 0;
    if (wait <= 0) write();
    else urlWrite.current.timer = setTimeout(write, wait);
  }, [screen, detailId, filtersOpen, searchOpen, mapQuery, routeQuery]);

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
  // Area whose last fetch failed. Pans inside it must not re-enter `loading`
  // only to fail the same way — the state already says everything there is to
  // say, and the loading → failure cycle is exactly what flickered the zone
  // card. Cleared on success, on retry/revalidate (`force`), never written by
  // the demo source (its provider cannot reject).
  const failedArea = useRef<{
    source: DataSourceId;
    center: GeoPoint;
    radiusKm: number;
  } | null>(null);
  const dispatchStations = useCallback(
    (ev: StationsEvent) => setStations((s) => nextStationsState(s, ev)),
    [],
  );
  const loadStations = useCallback(
    async (opts?: { force?: boolean }) => {
      // `force` is the retry/revalidate path (banner retry, `online`, stale
      // reload): skip every "nothing to do" fast path and go to the network.
      const force = opts?.force === true;
      if (force) failedArea.current = null;
      const area = loadedArea.current;
      if (
        !force &&
        area &&
        area.source === sourceId &&
        Date.now() - area.fetchedAt < STALE_MS &&
        haversineKm(area.center, searchPos) + radius <= area.radiusKm
      ) {
        return;
      }
      const reqId = ++stationsReq.current;
      // The durable tier is async (IndexedDB); the `loadedArea` fast path above
      // stays synchronous, so a live circle drag never waits on this.
      const cached = await readStationsCache(sourceId, searchPos, radius);
      if (reqId !== stationsReq.current) return;
      if (!force && cached && cached.covers && Date.now() - cached.fetchedAt < STALE_MS) {
        if (cached.center && cached.fetchRadiusKm != null) {
          loadedArea.current = {
            source: sourceId,
            center: cached.center,
            radiusKm: cached.fetchRadiusKm,
            fetchedAt: cached.fetchedAt,
          };
        }
        dispatchStations({
          kind: 'cache',
          data: cached.stations,
          source: sourceId,
          fetchedAt: cached.fetchedAt,
          revalidating: false,
        });
        return;
      }
      const failed = failedArea.current;
      if (
        !force &&
        failed &&
        failed.source === sourceId &&
        haversineKm(failed.center, searchPos) + radius <= failed.radiusKm
      ) {
        // Still inside the area that just failed: paint what the cache holds
        // for this zone (if anything) and wait for retry / connectivity.
        if (cached) {
          dispatchStations({
            kind: 'cache',
            data: cached.stations,
            source: sourceId,
            fetchedAt: cached.fetchedAt,
            revalidating: false,
          });
        }
        return;
      }
      if (cached) {
        dispatchStations({
          kind: 'cache',
          data: cached.stations,
          source: sourceId,
          fetchedAt: cached.fetchedAt,
          revalidating: true,
        });
      } else {
        dispatchStations({ kind: 'request', offlineHint: navigator.onLine === false });
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
        // A favorite seen in any fetch keeps its price for the Favoris tab
        recordFavoritePrices(favoriteIds.current, data, fetchedAt);
        loadedArea.current = { source: sourceId, center: searchPos, radiusKm: MAX_RADIUS_KM, fetchedAt };
        failedArea.current = null;
        dispatchStations({ kind: 'success', data, source: sourceId, fetchedAt });
      } catch {
        if (reqId !== stationsReq.current) return;
        // Failed loads must not shadow future retries behind the fast path
        loadedArea.current = null;
        failedArea.current = { source: sourceId, center: searchPos, radiusKm: MAX_RADIUS_KM };
        dispatchStations({
          kind: 'failure',
          source: sourceId,
          error: navigator.onLine === false ? 'offline' : 'source',
        });
      }
    },
    [sourceId, searchPos, radius, dispatchStations],
  );

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
      if (st.status === 'loading' || st.refreshing) return;
      // A standing failure revalidates as soon as anything plausibly changed
      // (connectivity back, tab foregrounded, next interval) — behind the
      // painted data when there is any, so nothing on screen resets.
      if (st.lastError != null) {
        void loadStations({ force: true });
        return;
      }
      if (st.status !== 'ready') return;
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

  // ── Favorite prices (Favoris tab) ──────────────────────────────────────────
  // Three tiers, cheapest first, run when the tab opens (never on boot, never
  // behind the map):
  //   1. the compact store — prices captured from past fetches, durable;
  //   2. a by-id sweep over the cached areas — zero network, adopts whatever
  //      IndexedDB already holds for these ids;
  //   3. a bounded, low-priority refresh of what is still stale, one group
  //      per country + place, resolved through the favorite's OWN country
  //      provider (whose partition memos make same-partition favorites cost
  //      one download). The results go through the same compact store, so the
  //      map's area cache is never written — a favorite refresh can never
  //      evict or thin an area the map is using.
  const refreshFavoritePrices = useCallback(async () => {
    const reqId = ++favPricesReq.current;
    const ids = favorites.map((f) => f.id);
    if (!ids.length) {
      setFavoritePrices({});
      return;
    }
    const held = await collectCachedStations(new Set(ids));
    for (const { station, fetchedAt } of held.values()) {
      recordFavoritePrices(favoriteIds.current, [station], fetchedAt);
    }
    const entries = await readFavoritePrices(ids);
    if (reqId !== favPricesReq.current) return;
    setFavoritePrices(Object.fromEntries(entries));
    if (navigator.onLine === false) return;
    // A source that answers by exact id (fra) refreshes all its favorites in
    // one request wherever they sit; the others fetch one circle per place.
    const byIdCountries = new Set(
      (['fra', 'esp', 'and', 'prt'] as const).filter(
        (country) => getProviders(country).stations.getStationsByIds != null,
      ),
    );
    const groups = planFavoriteRefresh(favorites, entries, {
      attemptedAt: favRefreshAttempted.current,
      byIdCountries,
    });
    if (!groups.length) return;
    await Promise.all(
      groups.map(async (group) => {
        for (const id of group.ids) favRefreshAttempted.current.set(id, Date.now());
        const provider = getProviders(group.country).stations;
        try {
          const stations = provider.getStationsByIds
            ? await provider.getStationsByIds(group.ids, { lowPriority: true })
            : await provider.getStationsNear(group.center, group.radiusKm, {
                lowPriority: true,
              });
          recordFavoritePrices(favoriteIds.current, stations, Date.now());
        } catch {
          /* the cached price stays on screen, with its honest age */
        }
      }),
    );
    const refreshed = await readFavoritePrices(ids);
    if (reqId !== favPricesReq.current) return;
    setFavoritePrices(Object.fromEntries(refreshed));
  }, [favorites]);

  useEffect(() => {
    if (screen !== 'favs') return;
    void refreshFavoritePrices();
  }, [screen, refreshFavoritePrices]);

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
  // Two stages, committed separately: the itinerary and its map show as soon as
  // the routing engine answers, the corridor stations land after. `routeReq`
  // orders the runs (two retries in a row share an input key, so the key alone
  // cannot tell them apart) and the key rejects an answer for endpoints the
  // user has since edited away.
  const routeReq = useRef(0);

  /** Place each corridor station along the route. The whole corridor is kept:
      the optimizer picks its own bounded, geographically distributed candidate
      set (lib/routeCandidates) — capping here on price destroyed coverage at
      the start of long routes. This is also the ONE place the corridor gets
      projected (see projectCorridor): measuring is O(stations × polyline
      vertices), far too expensive for a selector that reruns on every store
      update. */
  const placeAlongRoute = useCallback((raw: Station[], route: Route): RouteStation[] => {
    return projectCorridor(route, raw)
      .filter((st) => st.kmAlong > 1 && st.kmAlong < route.distanceKm - 1)
      .sort((a, b) => a.kmAlong - b.kmAlong);
  }, []);

  const runCorridor = useCallback(
    async (key: string, route: Route, reqId: number) => {
      try {
        const raw = await getProviders(sourceId).stations.getStationsAlong(route.polyline, 5);
        if (reqId !== routeReq.current) return;
        // The route corridor is the same shape of problem as the map area: a
        // favorite it crosses keeps its price for the Favoris tab
        recordFavoritePrices(favoriteIds.current, raw, Date.now());
        markRoute('route:stations');
        setRouteState((s) => commitCorridor(s, key, placeAlongRoute(raw, route)));
      } catch {
        if (reqId !== routeReq.current) return;
        // The geometry is real and stays on screen; only this stage failed, and
        // only this stage is retried. Inventing stops here would be a lie.
        setRouteState((s) => failCorridor(s, key, m.ribbon_corridor_failed()));
      }
    },
    [placeAlongRoute, sourceId],
  );

  const computeRoute = useCallback(
    async (from: GeoPoint, to: GeoPoint, endpoints: RouteEndpoints) => {
      const key = routeKey(from, to, { source: sourceId, avoidMotorway, avoidToll, vehicle });
      const reqId = ++routeReq.current;
      setRouteState((s) => beginGeometry(s, key));

      let route: Route;
      try {
        route = await getProviders(sourceId).route.getRoute(from, to, {
          avoidMotorway,
          avoidToll,
          vehicle,
        });
      } catch {
        if (reqId !== routeReq.current) return;
        // An honest error, never a substitution: the demo provider would
        // hand back a straight interpolated line and invented stops here.
        setRouteState((s) => failGeometry(s, key, m.route_error_unavailable()));
        return;
      }
      if (reqId !== routeReq.current) return;
      markRoute('route:geometry');
      setRouteState((s) => commitGeometry(s, key, route, endpoints));

      await runCorridor(key, route, reqId);
    },
    [avoidMotorway, avoidToll, runCorridor, sourceId, vehicle],
  );

  // ── Route travel matrix (the pipeline's third stage) ───────────────────────
  // Road legs for the fuel-stop plan: origin → stations → destination in ONE
  // matrix request — never one routing call per station. While it loads or
  // when it fails, the plan selectors run on the geometric estimate instead
  // (flagged `estimated`), so the timeline always has an answer. This effect
  // drives the stage's transitions; the pipeline owns their guards.
  const matrixKeyRef = useRef<string | null>(null);
  const matrixTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Only an unmount clears the pending call: the effect reruns on state the key
  // does not depend on, and a per-run cleanup would cancel a scheduled request
  // that the next run then skips as « same key », leaving it never sent.
  useEffect(() => () => clearTimeout(matrixTimer.current), []);
  useEffect(() => {
    const route = routeState.route;
    if (!route || routeState.stations.length === 0 || !fromPoint || !toPoint) {
      matrixKeyRef.current = null;
      clearTimeout(matrixTimer.current);
      setRouteState((s) => matrixBlocked(s, 'idle'));
      return;
    }
    const provider = getProviders(sourceId).route;
    const candidates = planCandidatesFor(
      routeState,
      fuel,
      { tank, consumption, startTankPct },
      plannedStops,
      provider.travelMatrixMaxPoints,
    );
    const getTravelMatrix = provider.getTravelMatrix?.bind(provider);
    if (!getTravelMatrix || !candidates.length) {
      // Nothing to measure and nothing to retry — a source without a matrix
      // backend is not a failure, and neither is a corridor with no candidate.
      // Either way the estimated legs ARE the final answer for this corridor.
      matrixKeyRef.current = null;
      clearTimeout(matrixTimer.current);
      setRouteState((s) => matrixBlocked(s, getTravelMatrix ? 'idle' : 'unsupported'));
      if (routeState.corridor === 'ready') markRoute('route:plan');
      return;
    }
    const key = travelMatrixKey(
      sourceId,
      fromPoint,
      toPoint,
      candidates.map((c) => c.station.id),
      { avoidMotorway, avoidToll, vehicle },
    );
    if (matrixKeyRef.current === key) return;
    matrixKeyRef.current = key;
    setRouteState((s) => beginMatrix(s, key));
    const points: GeoPoint[] = [
      fromPoint,
      ...candidates.map((c) => ({ lat: c.station.lat, lng: c.station.lng })),
      toPoint,
    ];
    // Public routing servers rate-limit, and a 429 is transient — but the key
    // stays put on failure, so nothing would ever ask again for this candidate
    // set: one flaky response would pin the plan to estimated legs until the
    // user happened to change something. Retry a bounded number of times with
    // a widening gap, then settle on `error`.
    const attempt = (n: number) => {
      if (matrixKeyRef.current !== key) return;
      getTravelMatrix(points, { avoidMotorway, avoidToll, vehicle })
        .then((cells) => {
          if (matrixKeyRef.current !== key) return;
          setRouteState((s) => commitMatrix(s, key, cells));
          markRoute('route:plan');
        })
        .catch(() => {
          if (matrixKeyRef.current !== key) return;
          if (n < MATRIX_RETRIES) {
            matrixTimer.current = setTimeout(() => attempt(n + 1), MATRIX_RETRY_BASE_MS * 2 ** n);
            return;
          }
          setRouteState((s) => failMatrix(s, key));
          markRoute('route:plan');
        });
    };
    // Settle before calling. The departure tank is a SLIDER: every step re-thins
    // the corridor, and each set it lands on would otherwise be a matrix request
    // against a public, rate-limited server — a drag would issue a dozen and
    // keep only the last. The plan runs on the geometric estimate until the call
    // returns, exactly as it does while loading.
    clearTimeout(matrixTimer.current);
    matrixTimer.current = setTimeout(() => attempt(0), MATRIX_DEBOUNCE_MS);
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
    // Leaving a screen leaves its search behind — plainly, without popping its
    // entry: the screen being pushed goes ON TOP of it, so Back walks from the
    // new screen right back into the search the user came from.
    setSearchOpen(null);
    setScreen((cur) => {
      // Swapping one fiche for another keeps the screen the first one was
      // opened from: that is still where closing the panel has to land, and
      // it is what tells the fiche whether it is read in route context.
      if (s === 'detail' && cur !== 'detail') setPrevScreen(cur);
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

  // Same for the place search: closing it from the UI (✕, Escape, a picked
  // place) pops the entry its opening pushed, instead of stacking a second
  // one that Back would then have to walk.
  const setSearchOpenNav = useCallback((target: SearchTarget | null) => {
    const cur = window.history.state as NavHistoryState | null;
    if (target == null && cur?.plein && navSearchTarget(cur) != null) window.history.back();
    else setSearchOpen(target);
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

  const startRoute = useCallback(async (toPick?: GeocodeResult) => {
    // A second tap must not open a second pipeline. The ref settles
    // synchronously, unlike the `geocoding` state the button renders.
    if (startingRef.current || !(toPick ?? toText.trim())) return;
    startingRef.current = true;
    setGeocoding(true);
    beginRouteTiming();
    try {
      let from = fromPoint;
      let to = toPick?.point ?? toPoint;
      let fromLabel = fromIsCurrentPosition ? '' : fromText.trim();
      let toLabel = toPick?.label ?? toText.trim();
      const geocode = getProviders(sourceId).geocode;
      if (!from && (fromIsCurrentPosition || !fromText.trim())) {
        from = userPos;
        fromLabel = '';
      }
      // An endpoint typed but never picked geocodes here — and a place the
      // user looked up joins the search history like a picked one would.
      // « Ma position » is not a place, so a current-position departure
      // remembers nothing. Both endpoints resolve together: one round trip
      // instead of two, and the form stays on screen, busy, for the whole
      // of it.
      const [fromHit, toHit] = await Promise.all([
        from
          ? null
          : geocode
              .search(fromText)
              .then((r) => r[0] ?? null)
              .catch(() => null),
        to
          ? null
          : geocode
              .search(toText)
              .then((r) => r[0] ?? null)
              .catch(() => null),
      ]);
      if (fromHit) {
        from = fromHit.point;
        fromLabel = fromHit.label;
        setFromText(fromHit.label);
        rememberSearchedPlace(fromHit);
      }
      if (toHit) {
        to = toHit.point;
        toLabel = toHit.label;
        setToText(toHit.label);
        rememberSearchedPlace(toHit);
      }
      if (!from || !to) {
        showToast(m.toast_address_not_found());
        return;
      }
      markRoute('route:geocoded');
      setFromPoint(from);
      setToPoint(to);
      setPlannedStops({});
      setRouteReady(true);
      // go(), not setScreen: a destination picked inside the phone's
      // full-screen search navigates FROM the open search, and go() stacks
      // the route screen on top of its entry instead of racing a pop.
      go('route');
      void computeRoute(from, to, {
        from: fromLabel || m.route_from_current_position(),
        to: toLabel,
      });
    } finally {
      startingRef.current = false;
      setGeocoding(false);
    }
  }, [
    computeRoute,
    fromIsCurrentPosition,
    fromPoint,
    fromText,
    go,
    rememberSearchedPlace,
    showToast,
    sourceId,
    toPoint,
    toText,
    userPos,
  ]);

  // A ribbon link runs its compute through the same `startRoute` path a
  // manual setup takes, so geocoding, error toasts and history entries behave
  // identically. One-shot by construction (the ref spends itself): the
  // URL rewrite that follows the compute must never re-trigger it — a route
  // is OSRM plus a corridor fetch, far too expensive to run twice.
  const pendingAutoStart = useRef(initialNav.screen === 'route');
  useEffect(() => {
    if (!pendingAutoStart.current || screen !== 'route') return;
    pendingAutoStart.current = false;
    void startRoute();
  }, [screen, startRoute]);

  /** Re-run both stages for the endpoints already resolved. */
  const retryRoute = useCallback(() => {
    if (!fromPoint || !toPoint) return;
    beginRouteTiming();
    void computeRoute(fromPoint, toPoint, {
      from: fromIsCurrentPosition
        ? m.route_from_current_position()
        : fromText.trim() || m.route_from_current_position(),
      to: toText.trim(),
    });
  }, [computeRoute, fromIsCurrentPosition, fromPoint, fromText, toPoint, toText]);

  const retryCorridor = useCallback(() => {
    const { route, key } = routeState;
    if (!route || !key) return;
    const reqId = ++routeReq.current;
    beginRouteTiming();
    setRouteState((s) => beginCorridor(s, key));
    void runCorridor(key, route, reqId);
  }, [routeState, runCorridor]);

  const editRoute = useCallback(() => setScreen('routeSetup'), []);

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
          services: activeServiceTags,
        },
        window.location.origin,
        { fuelLabel: fuelLabel(fuel), place: searchLabel },
      ),
    );
  }, [brandSel, fuel, mapZoom, radius, searchLabel, searchPos, activeServiceTags, share]);

  /**
   * Share the trip as it stands — the very same link the address bar carries
   * (both are built from `routeView`), for the standalone PWA that has no
   * address bar to copy it from.
   */
  const shareRoute = useCallback(() => {
    // Wording follows what is displayed: a computed route is labelled with
    // the endpoints it was computed for, never with text being edited.
    const from = routeState.route
      ? routeState.endpoints.from
      : fromIsCurrentPosition
        ? m.route_from_current_position()
        : fromText;
    const to = routeState.route ? routeState.endpoints.to : toText;
    share(routeShareData(routeView, window.location.origin, { from, to }));
  }, [fromIsCurrentPosition, fromText, routeState, routeView, share, toText]);

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
      searchOpen,
      setSearchOpen: setSearchOpenNav,
      focusStationId,
      setFocusStation: setFocusStationId,
      mapZoom,
      setMapZoom,
      favorites,
      isFavorite: (id) => favorites.some((f) => f.id === id),
      toggleFavorite,
      favoritePrices,
      stations,
      reloadStations: () => void loadStations({ force: true }),
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
      searchHistory,
      rememberSearchedPlace,
      routeReady,
      startRoute: (toPick?: GeocodeResult) => void startRoute(toPick),
      geocoding,
      editRoute,
      routeMode,
      setRouteMode,
      avoidMotorway,
      avoidToll,
      setAvoidMotorway,
      setAvoidToll,
      startTankPct,
      setStartTankPct,
      routeState,
      retryRoute,
      retryCorridor,
      plannedStops,
      togglePlannedStop,
      vehicle,
      setVehicle,
      tank,
      setTank,
      consumption,
      setConsumption,
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
      shareRoute,
      finishOnboarding,
      sheetHint,
      consumeSheetHint,
    }),
    [
      screen, prevScreen, go, back, openStation, fuel, setFuel, cycleFuel, sort, radius, setRadius,
      brandSel, toggleBrand, serviceTags, filtersOpen, resetFilters, userPos, geoStatus,
      requestGeolocation, searchPos, searchLabel, setSearchArea, resetSearchToUser,
      searchOpen, setSearchOpenNav,
      focusStationId, mapZoom, setMapZoom,
      favorites, toggleFavorite, favoritePrices, stations, roadReach, loadStations,
      fromText, fromIsCurrentPosition,
      toText, fromPoint, toPoint,
      setFrom, useCurrentPositionAsStart, setTo, searchPlaces, searchHistory,
      rememberSearchedPlace, routeReady,
      startRoute, geocoding, editRoute,
      routeMode, routeState, retryRoute, retryCorridor,
      plannedStops, togglePlannedStop, vehicle, setVehicle, tank, setTank,
      consumption, setConsumption,
      avoidMotorway, avoidToll, setAvoidMotorway, setAvoidToll, startTankPct, setStartTankPct,
      setFiltersOpenNav, sourceId, setSourceId, mapsSite, setMapsSite,
      locale, localeIsExplicit, setLocale, detailId, toast, showToast,
      canInstall, installDismissed, promptInstall, dismissInstallBanner, persisted.lastPos,
      openInMaps, openPlannedStopsInMaps, shareStation, shareMapView, shareRoute,
      finishOnboarding, sheetHint, consumeSheetHint,
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

export function effectiveFuel(s: Pick<Station, 'id' | 'prices'>, fuel: FuelId): FuelId | null {
  if (s.prices[fuel] != null) return fuel;
  const country = stationCountry(s.id);
  if (fuel === 'e10' && s.prices.unleaded95 != null && country && SP95_FOR_E10.includes(country)) {
    return 'unleaded95';
  }
  return null;
}

/** Price of the effective fuel (undefined when the station sells neither).
 *  Takes id + prices only, so a compact favorite-price entry qualifies. */
export function effectivePrice(
  s: Pick<Station, 'id' | 'prices'>,
  fuel: FuelId,
): FuelPrice | undefined {
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

// CROW_ROAD_FACTOR (imported above, re-exported): only the ROAD_REACH_MAX
// nearest stations get measured road numbers; without that factor the others
// would be ranked — and shown — on a shorter scale than the measured ones and
// would steal a recommendation they don't deserve.
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

/**
 * Sources that say whether a station dispenses AdBlue. Spain (`Precio Adblue`)
 * and Andorra (`idProducte` 9) declare the products on sale, so their silence
 * means the pump isn't there. The French flux (a closed 27-value service
 * vocabulary) and the Portuguese one (14 products) never mention AdBlue at
 * all, so theirs means nothing. Demo ids sit outside the country scheme and
 * the fixture speaks the app's own service ids, so the offline dataset answers
 * like a declaring source.
 */
const ADBLUE_COUNTRIES: ReadonlyArray<StationCountry | null> = ['esp', 'and', null];

/** Can this station's source answer « does it sell AdBlue »? */
export function answersAdBlue(s: Station): boolean {
  return ADBLUE_COUNTRIES.includes(stationCountry(s.id));
}

/**
 * Does the loaded population contain anything the AdBlue filter could bite on?
 * Gates the chip in the filters, exactly as `capabilities.brands` gates the
 * « Distributeurs » list: offering a filter no loaded station can answer would
 * be a promise the data cannot keep.
 */
export const selectAdBlueAnswerable = cached((app: AppStore): boolean =>
  app.stations.data.some(answersAdBlue),
);

/**
 * Does `s` satisfy the tag `t`?
 *
 * Plain `tags.includes` for every tag but AdBlue: there, a station whose
 * source never publishes the information passes rather than disappearing. The
 * alternative would turn « AdBlue » into « hide France », the app's largest
 * market. The list stays honest because a row and a fiche only show the AdBlue
 * chip where the source actually declared it.
 */
function passesTag(s: Station, t: ServiceTag): boolean {
  if (t === 'adBlue' && !answersAdBlue(s)) return true;
  return s.tags.includes(t);
}

/** Enriched stations passing the service-tag filter (no radius, brand or fuel) */
const selectTagged = cached((app: AppStore): NearbyStation[] => {
  const { serviceTags } = app;
  const wantedTags = (Object.keys(serviceTags) as ServiceTag[]).filter((t) => serviceTags[t]);
  if (!wantedTags.length) return selectEnriched(app);
  return selectEnriched(app).filter((s) => wantedTags.every((t) => passesTag(s, t)));
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

/**
 * Zone stations in the order the active sort chip asks for. « Recommandé »
 * (the default) ranks on the effective per-litre price — the comparator the
 * Favoris « Recommandé » sort uses (`sortFavoriteRows`), with the same
 * rules: equal effective prices fall back to distance, and a station whose
 * round trip exceeds the tank (effective price Infinity) sinks to the
 * bottom. It is a plain ordering of `effectiveLiterPrice`, without
 * `selectRecommended`'s tie margin — inside that margin the crowned row may
 * sit second, still wearing its « recommandée » flag.
 */
export const selectSorted = cached((app: AppStore): NearbyStation[] => {
  if (app.sort === 'price') return selectByPrice(app);
  if (app.sort === 'distance')
    return [...selectVisible(app)].sort((a, b) => a.distKm - b.distKm);
  const f = app.fuel;
  const eff = (s: NearbyStation) =>
    effectiveLiterPrice(app, effectivePrice(s, f)!.value, s.distKm);
  return [...selectVisible(app)].sort((a, b) => {
    const ea = eff(a);
    const eb = eff(b);
    if (ea === eb) return a.distKm - b.distKm;
    return ea - eb;
  });
});

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
 * « Prix » keeps the raw sticker order; rows without any known price (never
 * seen in an area or route fetch yet) and rows out of a full tank's round
 * trip (no effective price) sink to the bottom, sorted by distance.
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
    // A zone where no round trip fits the tank still crowns its nearest
    // station — every effective price is Infinity, which never satisfies the
    // tie test (Infinity − Infinity is NaN), yet an empty card would read as
    // « no stations » when the map clearly shows some.
    const tied = Number.isFinite(min) ? eff(s) - min <= RECO_TIE_CENTS : true;
    if (tied && (!pick || s.distKm < pick.distKm)) pick = s;
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

/**
 * The station the zone leads with: the one selected on the map, else the
 * recommended one. Null means the zone has NOTHING to show — no card, and
 * therefore no list under it. Both arrangements key their empty state on it,
 * and on desktop the panel slot keys its height on it too, so the three can
 * never disagree about whether the zone is empty.
 */
export function selectZoneLead(app: AppStore): NearbyStation | null {
  return selectFocusStation(app) ?? selectRecommended(app);
}

/** true while the zone has no answer yet — first load, or a reload in flight */
export function selectZoneLoading(app: AppStore): boolean {
  return app.stations.status === 'idle' || app.stations.status === 'loading';
}

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
    getProviders(app.sourceId).route.travelMatrixMaxPoints,
  ),
);

/**
 * Road legs the plan runs on: the committed matrix when it answers for the
 * current candidate set, the geometric estimate otherwise (loading, failure,
 * provider without a matrix backend). The quality flag rides along.
 */
const selectPlanLegs = cached((app: AppStore): PlanLegs | null => {
  const { routeState } = app;
  const route = routeState.route;
  if (!route) return null;
  const candidates = selectPlanCandidates(app);
  if (routeState.matrix === 'ready' && routeState.matrixCells && app.fromPoint && app.toPoint) {
    const key = travelMatrixKey(
      app.sourceId,
      app.fromPoint,
      app.toPoint,
      candidates.map((c) => c.station.id),
      { avoidMotorway: app.avoidMotorway, avoidToll: app.avoidToll, vehicle: app.vehicle },
    );
    if (key === routeState.matrixKey) {
      const legs = matrixPlanLegs(routeState.matrixCells, candidates.length, route);
      if (legs) return legs;
    }
  }
  return estimatePlanLegs(route, candidates);
});

/**
 * THE fuel-stop plan — pure solve over the candidate graph (lib/routeOptimizer):
 * the store only assembles immutable inputs, the algorithm lives outside it.
 * Null until the corridor has ever answered for a standing route — a plan over
 * stations that were never fetched would be an invention, not a computation.
 * User-picked stops (plannedStops) are constrained INTO the plan; the ones the
 * optimizer cannot place (no price for the fuel, off the corridor) surface in
 * `selectRouteAnalysis().invalidPlannedStopIds` instead of being ignored.
 */
export const selectRoutePlan = cached((app: AppStore): RoutePlan | null => {
  const { routeState } = app;
  const route = routeState.route;
  if (!route) return null;
  if (routeState.stations.length === 0 && routeState.corridor !== 'ready') return null;
  const legs = selectPlanLegs(app);
  if (!legs) return null;
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
  /** The computed plan (null while no corridor ever answered) */
  plan: RoutePlan | null;
  /** Plan stops in driving order, resolved to their stations */
  planStops: PlanStopView[];
  /** Best candidates OUTSIDE the plan, km order — browsing, never « the » plan */
  alternatives: RouteStation[];
  limitKm: number;
  autonomyKm: number;
  needsStop: boolean;
  arrival: ArrivalEstimate | null;
  /** Stops the user picked by hand (feed the multi-stop Maps run) */
  plannedStops: RouteStation[];
  /** User picks the optimizer could not place (no usable price / off corridor) */
  invalidPlannedStopIds: string[];
  /**
   * Minutes a lone stop at this candidate adds to the trip, on the plan's OWN
   * legs — routed whenever the matrix answered. This is what the cards must
   * display: `detourMin` is the load-time crow-flies estimate, and showing it
   * next to a plan optimized on real road legs makes the solver look wrong
   * (a motorway aire measures 0 m off the polyline yet can cost +13 min of
   * access; the plan rightly avoids it, the stale label says « sans détour »).
   */
  detourMinById: Record<string, number>;
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

/**
 * What a lone stop at candidate `i` would add to the trip — DRIVING km and
 * minutes over the direct leg (the refuelling halt itself is the same at every
 * station, so scoring and display both leave it out: it cannot change a
 * ranking and it would muddy the label). Measured on the plan's own legs, so
 * it is a routed figure whenever the matrix answered. `null` when the
 * candidate is not connected in both directions.
 */
function alternativeDetour(legs: PlanLegs, i: number): { km: number; min: number } | null {
  const there = legs.origin[i];
  const back = legs.destination[i];
  if (!there || !back) return null;
  return {
    km: Math.max(0, there.distanceKm + back.distanceKm - legs.direct.distanceKm),
    min: Math.max(0, there.durationMin + back.durationMin - legs.direct.durationMin),
  };
}

/**
 * Alternatives ranked the way the SELECTED STRATEGY ranks the plan — the chips
 * have to act on the whole ribbon, not only on the stops the solver kept. Price
 * folds the fuel burnt reaching the pump into the per-litre price (the same
 * effectiveLiterPrice the map recommendation uses), « détour min. » ranks on the
 * minutes the halt adds, « compromis » values those minutes in money. Ranking a
 * « détour min. » list by raw price offered the cheapest bargains 20 km off the
 * road under a chip that promises the opposite.
 */
function alternativeScore(
  app: Pick<AppStore, 'consumption' | 'tank' | 'routeMode'>,
  priceMilli: number,
  detour: { km: number; min: number },
): number {
  // Half the round trip: effectiveLiterPrice charges the drive there AND back
  const effective = effectiveLiterPrice(app, priceMilli / 1000, detour.km / 2);
  if (app.routeMode === 'price') return effective;
  if (app.routeMode === 'detour') return detour.min;
  return effective * app.tank + (VALUE_OF_TIME_CENTS_PER_MIN / 100) * detour.min;
}

/** Everything the route timeline needs, computed from real data */
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
  const legs = plan ? selectPlanLegs(app) : null;
  const alternatives = !legs
    ? []
    : candidates
        .map((c, i) => ({ c, detour: alternativeDetour(legs, i) }))
        .filter((e) => !planIds.has(e.c.station.id) && e.detour != null)
        .map((e) => ({
          station: e.c.station,
          score: alternativeScore(app, e.c.priceMilli, e.detour!),
        }))
        // The strategy score is the ONLY ranking. Sorting the departure tank's
        // reach ahead of it looks prudent and is not: on a 20 % tank it fills
        // the list with whatever sits in the first 120 km — two pumps 20 min
        // off the road beat an on-corridor bargain further on — and an
        // alternative is something to swap INTO the plan, reached after the
        // stops that precede it. The timeline's « limite d'autonomie » marker
        // is what says where the dry point falls.
        .sort((a, b) => a.score - b.score || (a.station.id < b.station.id ? -1 : 1))
        .slice(0, MAX_ALTERNATIVES)
        .map((e) => e.station)
        .sort((a, b) => a.kmAlong - b.kmAlong);

  const picked = routeState.stations.filter((s) => app.plannedStops[s.id]);
  const candidateIds = new Set(candidates.map((c) => c.station.id));
  const invalidPlannedStopIds = picked.map((s) => s.id).filter((id) => !candidateIds.has(id));

  const detourMinById: Record<string, number> = {};
  if (legs) {
    candidates.forEach((c, i) => {
      const d = alternativeDetour(legs, i);
      if (d) detourMinById[c.station.id] = Math.round(d.min);
    });
  }

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
    detourMinById,
    purchaseLitres: plan ? plan.stops.reduce((a, s) => a + s.purchasedLitres, 0) : null,
    purchaseCostCents: plan ? plan.totalPurchaseCostCents : null,
    destinationFuelLitres: plan ? plan.destinationFuelLitres : null,
    quality: plan?.quality ?? null,
  };
}
