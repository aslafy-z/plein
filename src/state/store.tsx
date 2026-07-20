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
import { IS_ANDROID, IS_IOS } from '../lib/env';
import type { GeoPoint } from '../lib/geo';
import { cumulativeKm, haversineKm, nearestOnPolyline } from '../lib/geo';
import {
  ALL_FUELS,
  type VehicleId,
  type DataSourceId,
  type FuelId,
  type FuelPrice,
  type GeocodeResult,
  type NearbyStation,
  type Route,
  type RouteStation,
  type ServiceTag,
  type Station,
} from '../data/types';
import { getProviders } from '../data/providers';
import { brandGroup } from '../lib/brandIcons';
import { readStationsCache, writeStationsCache, STALE_MS } from '../data/stationsCache';
import {
  installReady,
  isStandalone,
  promptInstall as nativeInstallPrompt,
  subscribeInstall,
} from '../lib/installPrompt';

// ── Constants ────────────────────────────────────────────────────────────────
/** Toulouse Capitole — default position when geolocation is unavailable */
export const DEFAULT_POS: GeoPoint = { lat: 43.6047, lng: 1.4442 };
/** Route departure placeholder — resolves to the user's current position */
export const DEFAULT_FROM_LABEL = 'Ma position';
/** Recent-trip history kept in Réglages persistence */
const MAX_RECENTS = 4;
export const MAX_RADIUS_KM = 25;
/** Vehicle profile presets (tank L, consumption L/100 km, default fuel) — adjustable in Réglages */
export const VEHICLE_PRESETS: Record<VehicleId, { tank: number; conso: number; fuel: FuelId }> = {
  car: { tank: 50, conso: 6.5, fuel: 'gazole' },
  moto: { tank: 15, conso: 5, fuel: 'e10' },
};
const DEFAULT_CONSO = VEHICLE_PRESETS.car.conso;
/** Default departure tank level (%) — adjustable on the route setup */
const DEFAULT_START_TANK_PCT = 70;
/** € value of one minute of detour, for the « compromis » strategy */
const EUR_PER_DETOUR_MIN = 0.35;
/** Minutes spent actually refuelling at a stop */
const REFUEL_MIN = 4;

export type Screen =
  | 'onboarding'
  | 'map'
  | 'favs'
  | 'routeSetup'
  | 'route'
  | 'settings'
  | 'detail';

export type RouteMode = 'compromis' | 'prix' | 'detour';
export type SortMode = 'prix' | 'dist';

/** Web maps site used by « Y aller » on desktop (mobile opens the native GPS app) */
export type MapsSiteId = 'google' | 'waze' | 'apple' | 'osm';
export const MAPS_SITES: { id: MapsSiteId; label: string }[] = [
  { id: 'google', label: 'Google Maps' },
  { id: 'waze', label: 'Waze' },
  { id: 'apple', label: 'Apple Plans' },
  { id: 'osm', label: 'OpenStreetMap' },
];
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

// ── Persistence ──────────────────────────────────────────────────────────────
const LS_KEY = 'plein.settings.v1';

interface PersistedSettings {
  fuel: FuelId;
  vehicle: VehicleId;
  tank: number;
  conso: number;
  avoidMotorway: boolean;
  avoidToll: boolean;
  startTankPct: number;
  radius: number;
  sourceId: DataSourceId;
  onboarded: boolean;
  alerts: boolean;
  mapsSite: MapsSiteId;
  /** Last position the app was centered on — restored on reload so the
      station cache hits instantly instead of flashing Toulouse/demo data */
  lastPos: GeoPoint;
  /** true when geolocation succeeded before — on reload the first stations
      fetch waits for the fresh fix instead of loading the stale area twice */
  geoGranted: boolean;
  installDismissed: boolean;
  bgloc: boolean;
  recents: { label: string; sublabel: string; point: GeoPoint }[];
  /** Pinned stations — snapshot so they render even out of the loaded area */
  favorites: FavoriteStation[];
  /** Selected brand labels in the filters (empty/absent = every brand) */
  brandSel: string[];
}

export interface FavoriteStation {
  id: string;
  name: string;
  init: string;
  city?: string;
  lat: number;
  lng: number;
}

function loadPersisted(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedSettings>) : {};
  } catch {
    return {};
  }
}

function savePersisted(p: Partial<PersistedSettings>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...loadPersisted(), ...p }));
  } catch {
    /* private mode etc. — non-fatal */
  }
}

/** Destination suggestions shown until the user has real trip history */
export const DEFAULT_RECENTS: PersistedSettings['recents'] = [
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
  stations: StationsState;
  reloadStations(): void;

  // favorites (Favoris tab)
  favorites: FavoriteStation[];
  isFavorite(id: string): boolean;
  toggleFavorite(s: FavoriteStation): void;

  // route
  fromText: string;
  toText: string;
  fromPoint: GeoPoint | null;
  toPoint: GeoPoint | null;
  setFrom(text: string, point?: GeoPoint | null): void;
  setTo(text: string, point?: GeoPoint | null): void;
  searchPlaces(q: string): Promise<GeocodeResult[]>;
  recents: PersistedSettings['recents'];
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
  tour: Record<string, boolean>;
  toggleTour(id: string): void;

  // settings
  vehicle: VehicleId;
  /** Switch profile and apply its tank/conso/fuel presets */
  setVehicle(v: VehicleId): void;
  tank: number;
  setTank(t: number): void;
  /** Average consumption, L/100 km — feeds autonomy + trip cost */
  conso: number;
  setConso(v: number): void;
  alerts: boolean;
  setAlerts(v: boolean): void;
  bgloc: boolean;
  setBgloc(v: boolean): void;
  sourceId: DataSourceId;
  setSourceId(s: DataSourceId): void;
  /** Maps website opened by « Y aller » on desktop */
  mapsSite: MapsSiteId;
  setMapsSite(s: MapsSiteId): void;

  // detail
  detailId: string | null;

  // maps + toast
  toast: string | null;
  notify(msg: string): void;
  openInMaps(target: Station | RouteStation): void;
  openTourInMaps(): void;

  // PWA install
  installReady: boolean;
  installBannerVisible: boolean;
  promptInstall(): void;
  dismissInstallBanner(): void;

  // onboarding
  finishOnboarding(withGeoloc: boolean): void;
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
    return { screen: 'detail', detailId: decodeURIComponent(path.slice('/station/'.length)) };
  }
  return { screen: 'map', detailId: null };
}

const Ctx = createContext<AppStore | null>(null);

// ── Provider component ───────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useRef(loadPersisted()).current;

  const initialNav = navFromPath(window.location.pathname);
  const [screen, setScreen] = useState<Screen>(
    persisted.onboarded ? initialNav.screen : 'onboarding',
  );
  const [prevScreen, setPrevScreen] = useState<Screen>('map');
  const [fuel, setFuelState] = useState<FuelId>(persisted.fuel ?? 'gazole');
  const [sort, setSort] = useState<SortMode>('prix');
  const [radius, setRadiusState] = useState<number>(persisted.radius ?? 5);
  // Persisted selections may predate a grouping change ("Total", "Esso
  // Express"…) — remap them onto the current canonical groups.
  const [brandSel, setBrandSelState] = useState<string[]>(() => [
    ...new Set((persisted.brandSel ?? []).map(brandGroup)),
  ]);
  const [serviceTags, setServiceTags] = useState<Partial<Record<ServiceTag, boolean>>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>('compromis');
  const [tour, setTour] = useState<Record<string, boolean>>({});
  const [detailId, setDetailId] = useState<string | null>(
    persisted.onboarded ? initialNav.detailId : null,
  );
  const [fromText, setFromText] = useState(DEFAULT_FROM_LABEL);
  const [toText, setToText] = useState('');
  const [fromPoint, setFromPoint] = useState<GeoPoint | null>(null);
  const [toPoint, setToPoint] = useState<GeoPoint | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const [vehicle, setVehicleState] = useState<VehicleId>(persisted.vehicle ?? 'car');
  const [tank, setTankState] = useState<number>(persisted.tank ?? VEHICLE_PRESETS.car.tank);
  const [conso, setConsoState] = useState<number>(persisted.conso ?? DEFAULT_CONSO);
  const [avoidMotorway, setAvoidMotorwayState] = useState<boolean>(persisted.avoidMotorway ?? false);
  const [avoidToll, setAvoidTollState] = useState<boolean>(persisted.avoidToll ?? false);
  const [startTankPct, setStartTankPctState] = useState<number>(
    persisted.startTankPct ?? DEFAULT_START_TANK_PCT,
  );
  const [alerts, setAlertsState] = useState<boolean>(persisted.alerts ?? true);
  const [bgloc, setBglocState] = useState<boolean>(persisted.bgloc ?? false);
  // Forced migration to « Automatique » : legacy persisted ids ('gouv' before
  // the country rename) and new installs land on 'auto'; only explicit choices
  // of the current scheme survive.
  const [sourceId, setSourceIdState] = useState<DataSourceId>(() => {
    const saved = persisted.sourceId as string | undefined;
    return saved === 'fra' || saved === 'esp' || saved === 'and' || saved === 'demo'
      ? saved
      : 'auto';
  });
  const [mapsSite, setMapsSiteState] = useState<MapsSiteId>(persisted.mapsSite ?? 'google');
  const [toast, setToast] = useState<string | null>(null);
  // Start from the last known position so the per-area cache hits instantly
  const initialPos = persisted.lastPos ?? DEFAULT_POS;
  const [userPos, setUserPos] = useState<GeoPoint>(initialPos);
  const [geoStatus, setGeoStatus] = useState<AppStore['geoStatus']>('pending');
  // Search area: follows the user's position until they search elsewhere on the map
  const [searchPos, setSearchPos] = useState<GeoPoint>(initialPos);
  const [searchLabel, setSearchLabel] = useState<string | null>(null);
  const [focusStationId, setFocusStationId] = useState<string | null>(null);
  const searchMovedRef = useRef(false);
  // Geolocation worked last session → hold the initial stations fetch until
  // the fresh fix lands (or a short fallback delay), so the app loads the
  // right area once instead of fetching the stale area and jumping.
  const [geoHold, setGeoHold] = useState<boolean>(
    persisted.onboarded === true && persisted.geoGranted === true && 'geolocation' in navigator,
  );

  const [favorites, setFavorites] = useState<FavoriteStation[]>(persisted.favorites ?? []);
  const toggleFavorite = useCallback((s: FavoriteStation) => {
    setFavorites((prev) => {
      const next = prev.some((f) => f.id === s.id)
        ? prev.filter((f) => f.id !== s.id)
        : [...prev, s];
      savePersisted({ favorites: next });
      return next;
    });
  }, []);
  const [recents, setRecents] = useState(persisted.recents ?? DEFAULT_RECENTS);
  const [hasTripHistory, setHasTripHistory] = useState(persisted.recents != null);
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

  useEffect(() => {
    const state = { plein: true, screen, detailId, filtersOpen };
    const fromPop = popNavRef.current;
    popNavRef.current = false;
    const cameFrom = lastNavScreenRef.current;
    lastNavScreenRef.current = screen;
    if (fromPop) return;
    const cur = window.history.state as typeof state | null;
    if (
      cur?.plein &&
      cur.screen === screen &&
      (cur.detailId ?? null) === detailId &&
      !!cur.filtersOpen === filtersOpen
    )
      return;
    const path = pathFor(screen, detailId);
    // First entry — and leaving onboarding must not be back-navigable
    if (!cur?.plein || cameFrom === 'onboarding') window.history.replaceState(state, '', path);
    else window.history.pushState(state, '', path);
  }, [screen, detailId, filtersOpen]);

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
  /** Record a real trip in the « Récents » history (replaces the default suggestions) */
  const pushRecent = useCallback(
    (label: string, point: GeoPoint, distanceKm: number) => {
      const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(
        new Date(),
      );
      const entry = {
        label,
        sublabel: `${Math.round(distanceKm)} km · fait le ${date}`,
        point,
      };
      setRecents((prev) => {
        const base = hasTripHistory ? prev : [];
        const next = [entry, ...base.filter((r) => r.label !== label)].slice(0, MAX_RECENTS);
        savePersisted({ recents: next });
        return next;
      });
      setHasTripHistory(true);
    },
    [hasTripHistory],
  );

  const routeReq = useRef(0);
  const computeRoute = useCallback(
    async (from: GeoPoint, to: GeoPoint, toLabel: string) => {
      const reqId = ++routeReq.current;
      setRouteState((s) => ({ ...s, status: 'loading' }));
      const run = async (src: DataSourceId) => {
        const bundle = getProviders(src);
        const route = await bundle.route.getRoute(from, to, { avoidMotorway, avoidToll, vehicle });
        const raw = await bundle.stations.getStationsAlong(route.polyline, 5);
        const cum = cumulativeKm(route.polyline);
        const enriched: RouteStation[] = raw
          .map((st) => {
            const near = nearestOnPolyline({ lat: st.lat, lng: st.lng }, route.polyline, cum);
            return {
              ...st,
              kmAlong: Math.round(near.alongKm),
              // ~60 km/h there and back on local roads; on-route stations count as 0
              detourMin: near.distKm < 0.4 ? 0 : Math.max(1, Math.round(near.distKm * 2)),
            };
          })
          .filter((st) => st.kmAlong > 5 && st.kmAlong < route.distanceKm - 5)
          .sort((a, b) => a.kmAlong - b.kmAlong);
        // Keep the full corridor (bounded for perf) — WHICH stops are shown is
        // decided per strategy in selectRouteAnalysis, so the chips act on the
        // whole ribbon, not just the recommendation.
        const capped =
          enriched.length <= 30
            ? enriched
            : [...enriched]
                .sort(
                  (a, b) =>
                    (effectivePrice(a, fuel)?.value ?? 9) - (effectivePrice(b, fuel)?.value ?? 9),
                )
                .slice(0, 30)
                .sort((a, b) => a.kmAlong - b.kmAlong);
        return { route, stations: capped };
      };
      try {
        const res = await run(sourceId);
        if (reqId !== routeReq.current) return;
        setRouteState({ status: 'ready', ...res, fellBack: false });
        pushRecent(toLabel, to, res.route.distanceKm);
      } catch {
        if (reqId !== routeReq.current) return;
        if (sourceId !== 'demo') {
          try {
            const res = await run('demo');
            if (reqId !== routeReq.current) return;
            setRouteState({ status: 'ready', ...res, fellBack: true });
            pushRecent(toLabel, to, res.route.distanceKm);
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
          error: 'Itinéraire indisponible. Vérifiez votre connexion.',
        });
      }
    },
    [sourceId, fuel, pushRecent, avoidMotorway, avoidToll, vehicle],
  );

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
    const cur = window.history.state as { plein?: boolean; screen?: Screen } | null;
    if (cur?.plein && cur.screen === 'detail') window.history.back();
    else setScreen(prevScreen);
  }, [prevScreen]);

  // Closing the filters sheet from the UI pops the entry its opening pushed,
  // so a later back press doesn't re-close an already-closed sheet.
  const setFiltersOpenNav = useCallback((open: boolean) => {
    const cur = window.history.state as { plein?: boolean; filtersOpen?: boolean } | null;
    if (!open && cur?.plein && cur.filtersOpen) window.history.back();
    else setFiltersOpen(open);
  }, []);

  const setFuel = useCallback((f: FuelId) => {
    setFuelState(f);
    savePersisted({ fuel: f });
  }, []);

  const cycleFuel = useCallback(() => {
    setFuelState((cur) => {
      const idx = ALL_FUELS.indexOf(cur);
      const next = ALL_FUELS[(idx + 1) % ALL_FUELS.length];
      savePersisted({ fuel: next });
      return next;
    });
  }, []);

  const setRadius = useCallback((r: number) => {
    setRadiusState(r);
    savePersisted({ radius: r });
  }, []);

  const setTank = useCallback((t: number) => {
    setTankState(t);
    savePersisted({ tank: t });
  }, []);

  const setConso = useCallback((v: number) => {
    setConsoState(v);
    savePersisted({ conso: v });
  }, []);

  const setVehicle = useCallback((v: VehicleId) => {
    setVehicleState(v);
    const preset = VEHICLE_PRESETS[v];
    setTankState(preset.tank);
    setConsoState(preset.conso);
    // A moto runs on SP95-E10, not gazole — the fuel follows the profile
    setFuelState(preset.fuel);
    savePersisted({ vehicle: v, tank: preset.tank, conso: preset.conso, fuel: preset.fuel });
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

  const setBgloc = useCallback((v: boolean) => {
    setBglocState(v);
    savePersisted({ bgloc: v });
  }, []);

  const setSourceId = useCallback((s: DataSourceId) => {
    setSourceIdState(s);
    savePersisted({ sourceId: s });
  }, []);

  const setMapsSite = useCallback((s: MapsSiteId) => {
    setMapsSiteState(s);
    savePersisted({ mapsSite: s });
  }, []);

  const toggleBrand = useCallback((label: string) => {
    setBrandSelState((sel) => {
      const next = sel.includes(label) ? sel.filter((b) => b !== label) : [...sel, label];
      savePersisted({ brandSel: next });
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setRadius(5);
    setBrandSelState([]);
    savePersisted({ brandSel: [] });
    setServiceTags({});
    setFuel('gazole');
  }, [setFuel, setRadius]);

  const searchPlaces = useCallback(
    (q: string) => getProviders(sourceId).geocode.search(q),
    [sourceId],
  );

  const setFrom = useCallback((text: string, point: GeoPoint | null = null) => {
    setFromText(text);
    setFromPoint(point);
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
    const geocode = getProviders(sourceId).geocode;
    try {
      if (!from) {
        if (fromText.trim() === DEFAULT_FROM_LABEL || !fromText.trim()) {
          from = userPos;
        } else {
          const r = await geocode.search(fromText);
          from = r[0]?.point ?? null;
          if (r[0]) setFromText(r[0].label);
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
      showToast('Adresse introuvable — précisez la destination');
      return;
    }
    setFromPoint(from);
    setToPoint(to);
    setTour({});
    setRouteReady(true);
    setScreen('route');
    void computeRoute(from, to, toLabel);
  }, [computeRoute, fromPoint, fromText, showToast, sourceId, toPoint, toText, userPos]);

  const editRoute = useCallback(() => setScreen('routeSetup'), []);

  const [focusDestination, setFocusDestination] = useState(false);
  const openRouteSearch = useCallback(() => {
    setFocusDestination(true);
    setScreen('routeSetup');
  }, []);
  const consumeFocusDestination = useCallback(() => setFocusDestination(false), []);

  const toggleTour = useCallback((id: string) => {
    setTour((t) => ({ ...t, [id]: !t[id] }));
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
            [target.brand, target.address, target.cp, target.city].filter(Boolean).join(' '),
          )
        : null;
      if (IS_ANDROID) {
        showToast("Ouverture de l'app GPS…");
        const label = encodeURIComponent(target.name);
        const q = poiQuery ?? `${target.lat},${target.lng}(${label})`;
        window.location.href = `geo:${target.lat},${target.lng}?q=${q}`;
        return;
      }
      if (IS_IOS) {
        showToast('Ouverture de Plans…');
        window.location.href = `https://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d`;
        return;
      }
      // Desktop: the site is a Réglages choice (Google Maps by default).
      // Unlike geo:, the Google dir URL carries no coordinate anchor for a
      // text search — only use it when a street address can disambiguate.
      const site = MAPS_SITES.find((s) => s.id === mapsSite) ?? MAPS_SITES[0];
      showToast(`Ouverture de ${site.label}…`);
      const url =
        site.id === 'google' && poiQuery && target.address
          ? `https://www.google.com/maps/dir/?api=1&destination=${poiQuery}&travelmode=driving`
          : mapsSiteUrl(site.id, target.lat, target.lng);
      window.open(url, '_blank', 'noopener');
    },
    [showToast, mapsSite],
  );

  const openTourInMaps = useCallback(() => {
    const stops = routeState.stations.filter((s) => tour[s.id]);
    if (!stops.length || !toPoint) return;
    // Multi-stop URLs are a Google Maps feature — used on every platform
    // (Android/iOS open the Google Maps app via universal links when installed).
    showToast('Ouverture de Google Maps…');
    const waypoints = stops.map((s) => `${s.lat},${s.lng}`).join('|');
    const origin = fromPoint ? `&origin=${fromPoint.lat},${fromPoint.lng}` : '';
    const url = `https://www.google.com/maps/dir/?api=1${origin}&destination=${toPoint.lat},${toPoint.lng}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    window.open(url, '_blank', 'noopener');
  }, [fromPoint, routeState.stations, showToast, toPoint, tour]);

  const finishOnboarding = useCallback(
    (withGeoloc: boolean) => {
      savePersisted({ onboarded: true });
      if (withGeoloc) requestGeolocation();
      else setGeoStatus('denied');
      setScreen('map');
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
      favorites,
      isFavorite: (id) => favorites.some((f) => f.id === id),
      toggleFavorite,
      stations,
      reloadStations: () => void loadStations(),
      fromText,
      toText,
      fromPoint,
      toPoint,
      setFrom,
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
      tour,
      toggleTour,
      vehicle,
      setVehicle,
      tank,
      setTank,
      conso,
      setConso,
      alerts,
      setAlerts,
      bgloc,
      setBgloc,
      sourceId,
      setSourceId,
      mapsSite,
      setMapsSite,
      detailId,
      installReady: canInstall && !isStandalone(),
      installBannerVisible: canInstall && !isStandalone() && !installDismissed,
      promptInstall,
      dismissInstallBanner,
      toast,
      notify: showToast,
      openInMaps,
      openTourInMaps,
      finishOnboarding,
    }),
    [
      screen, prevScreen, go, back, openStation, fuel, setFuel, cycleFuel, sort, radius, setRadius,
      brandSel, toggleBrand, serviceTags, filtersOpen, resetFilters, userPos, geoStatus,
      requestGeolocation, searchPos, searchLabel, setSearchArea, resetSearchToUser,
      focusStationId, favorites, toggleFavorite, stations, loadStations, fromText, toText, fromPoint, toPoint,
      setFrom, setTo, searchPlaces, recents, hasTripHistory, routeReady, startRoute, editRoute,
      openRouteSearch, focusDestination, consumeFocusDestination,
      routeMode, routeState, tour, toggleTour, vehicle, setVehicle, tank, setTank, conso, setConso,
      avoidMotorway, avoidToll, setAvoidMotorway, setAvoidToll, startTankPct, setStartTankPct,
      setFiltersOpenNav, alerts, setAlerts,
      bgloc, setBgloc, sourceId, setSourceId, mapsSite, setMapsSite, detailId, toast, showToast,
      canInstall, installDismissed, promptInstall, dismissInstallBanner, persisted.lastPos,
      openInMaps, openTourInMaps, finishOnboarding,
    ],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

// ── Derived selectors (pure — shared by every screen) ────────────────────────

/**
 * Fuel actually compared and displayed for a station. E10 barely exists in
 * Spain (a handful of stations country-wide) and not at all in Andorra —
 * their SP95 (E5) is what an E10 vehicle fills up there, so those stations
 * join the E10 map with their SP95 price. Never the reverse: an SP95-only
 * engine must not be sent to an E10 pump, and French stations list both
 * fuels separately anyway.
 */
export function effectiveFuel(s: Station, fuel: FuelId): FuelId | null {
  if (s.prices[fuel] != null) return fuel;
  if (
    fuel === 'e10' &&
    s.prices.sp95 != null &&
    (s.id.startsWith('esp-') || s.id.startsWith('and-'))
  ) {
    return 'sp95';
  }
  return null;
}

/** Price of the effective fuel (undefined when the station sells neither) */
export function effectivePrice(s: Station, fuel: FuelId): FuelPrice | undefined {
  const f = effectiveFuel(s, fuel);
  return f ? s.prices[f] : undefined;
}

/** Stations passing the current filters, enriched with distance, for a given fuel */
export function selectVisibleForFuel(app: AppStore, fuel: FuelId): NearbyStation[] {
  const { stations, userPos, searchPos, radius, brandSel, serviceTags } = app;
  const wantedTags = (Object.keys(serviceTags) as ServiceTag[]).filter((t) => serviceTags[t]);
  return stations.data
    .map((s) => {
      // Displayed distance is from the user; the radius applies to the search area
      const distKm = haversineKm(userPos, { lat: s.lat, lng: s.lng });
      const searchKm = haversineKm(searchPos, { lat: s.lat, lng: s.lng });
      return { ...s, distKm, searchKm, driveMin: Math.max(1, Math.round(distKm * 2)) };
    })
    .filter(
      (s) =>
        s.searchKm <= radius &&
        effectivePrice(s, fuel) != null &&
        // Brandless stations pass as « Indépendants & autres » via brandGroup
        (brandSel.length === 0 || brandSel.includes(brandGroup(s.brand))) &&
        wantedTags.every((t) => s.tags.includes(t)),
    );
}

/** Stations passing the current filters, for the currently selected fuel */
export function selectVisible(app: AppStore): NearbyStation[] {
  return selectVisibleForFuel(app, app.fuel);
}

/**
 * Fuels actually sold in the zone (radius + brand/service filters). Drives
 * the empty state when the selected fuel isn't sold at all — E10 and E85
 * barely exist outside France (nowhere in Andorra, a handful of Spanish
 * stations), so an empty map must say so instead of looking broken.
 */
export function selectZoneFuels(app: AppStore): FuelId[] {
  // Raw prices only — a fuel reachable through the SP95 fallback is not
  // « sold here », the chip must name what the pumps actually serve
  return ALL_FUELS.filter((f) =>
    selectVisibleForFuel(app, f).some((s) => s.prices[f] != null),
  );
}

/**
 * Stations drawn on the map: every loaded station passing the fuel/brand/
 * service filters, NOT limited to the radius circle. Restricting pins to the
 * radius makes them pop in and out while panning; the circle stays a visual
 * indicator of the « cheapest near you » zone.
 */
export function selectMapStations(app: AppStore): NearbyStation[] {
  const { stations, userPos, searchPos, brandSel, serviceTags, fuel } = app;
  const wantedTags = (Object.keys(serviceTags) as ServiceTag[]).filter((t) => serviceTags[t]);
  return stations.data
    .map((s) => {
      const distKm = haversineKm(userPos, { lat: s.lat, lng: s.lng });
      const searchKm = haversineKm(searchPos, { lat: s.lat, lng: s.lng });
      return { ...s, distKm, searchKm, driveMin: Math.max(1, Math.round(distKm * 2)) };
    })
    .filter(
      (s) =>
        effectivePrice(s, fuel) != null &&
        (brandSel.length === 0 || brandSel.includes(brandGroup(s.brand))) &&
        wantedTags.every((t) => s.tags.includes(t)),
    );
}

/**
 * Zone stations cheapest-first. Prices are DISPLAYED at cent precision while
 * the feeds carry tenths of a cent (1,896 vs 1,904 both read « 1,90 €»), so
 * the ranking works in cents too: at the same displayed price the NEAREST
 * station comes first — the recommended pump must never be a farther one
 * for a difference the user cannot even see.
 */
export function selectByPrice(app: AppStore): NearbyStation[] {
  const f = app.fuel;
  const cents = (s: NearbyStation) => priceCents(effectivePrice(s, f)?.value ?? 9);
  return [...selectVisible(app)].sort((a, b) => cents(a) - cents(b) || a.distKm - b.distKm);
}

export function selectSorted(app: AppStore): NearbyStation[] {
  if (app.sort === 'prix') return selectByPrice(app);
  return [...selectVisible(app)].sort((a, b) => a.distKm - b.distKm);
}

/** Cheapest STICKER price of the zone — labels (« meilleur prix ») and deltas */
export function selectCheapest(app: AppStore): NearbyStation | null {
  return selectByPrice(app)[0] ?? null;
}

/**
 * Per-litre price with the trip to the pump folded in: the fuel burnt driving
 * there and back (conso & réservoir des Réglages) is bought at that station's
 * own price — what a full tank ACTUALLY costs per litre. Shared by the map
 * recommendation and the « Recommandé » sort of the Favoris.
 */
export function effectiveLiterPrice(app: AppStore, price: number, distKm: number): number {
  return price * (1 + (distKm * 2 * app.conso) / 100 / app.tank);
}

/**
 * Effective prices within this margin (cents) count as equal — feeds go
 * stale for days and distances are crow-flies, a cent of effective gap is
 * noise, not a reason to drive farther.
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
export function selectRecommended(app: AppStore): NearbyStation | null {
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
}

/**
 * Station currently selected on the map (pin tapped / list row tapped).
 * Resolved against the map pins so a station outside the radius circle can
 * still be selected; null when the selection no longer matches the filters.
 */
export function selectFocusStation(app: AppStore): NearbyStation | null {
  if (!app.focusStationId) return null;
  return selectMapStations(app).find((s) => s.id === app.focusStationId) ?? null;
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
export function selectPriceStats(app: AppStore): PriceStats | null {
  const f = app.fuel;
  const prices = selectMapStations(app).map((s) => effectivePrice(s, f)!.value);
  if (!prices.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of prices) {
    if (p < min) min = p;
    if (p > max) max = p;
    sum += p;
  }
  const mean = sum / prices.length;
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
}

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
export function selectDeals(app: AppStore): NearbyStation[] {
  const stats = selectPriceStats(app);
  if (!stats) return [];
  const f = app.fuel;
  return selectByPrice(app).filter(
    (s) => priceTier(effectivePrice(s, f)!.value, stats, true) === 'deal',
  );
}

export function selectPriceRange(app: AppStore): { min: number; max: number } | null {
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
}

/** Autonomy narrative for the route ribbon (depends on tank setting) */
export function selectAutonomy(app: AppStore): { autonomyKm: number; limitKm: number } {
  const autonomyKm = Math.round(((app.tank * (app.startTankPct / 100)) / app.conso) * 100);
  // Keep a ~20 % reserve before the "you must stop" line
  const limitKm = Math.round((autonomyKm * 0.8) / 10) * 10;
  return { autonomyKm, limitKm };
}

export interface RouteAnalysis {
  stops: RouteStation[];
  recoId: string | null;
  recoSub: string;
  limitKm: number;
  autonomyKm: number;
  needsStop: boolean;
  arrivalLabel: string;
  tourStops: RouteStation[];
  /** Fuel needed for the whole trip at the configured consumption */
  tripLitres: number | null;
  /** Trip fuel cost at the recommended stop's price (fallback: cheapest on route) */
  tripCost: number | null;
}

/** Everything the route ribbon needs, computed from real data */
export function selectRouteAnalysis(app: AppStore): RouteAnalysis {
  const { routeState, routeMode, fuel, tank, tour } = app;
  const { limitKm, autonomyKm } = selectAutonomy(app);
  const route = routeState.route;
  const needsStop = !!route && route.distanceKm > limitKm;

  const priceOf = (s: RouteStation) => effectivePrice(s, fuel)?.value ?? Infinity;
  // Strategy score — the SAME ranking picks the shown stops and the reco,
  // so the strategy chips act on the whole ribbon.
  const scoreOf = (s: RouteStation): number => {
    if (routeMode === 'prix') return priceOf(s);
    if (routeMode === 'detour') return s.detourMin * 1000 + priceOf(s);
    return priceOf(s) * tank + s.detourMin * EUR_PER_DETOUR_MIN;
  };

  const all = routeState.stations.filter((s) => effectivePrice(s, fuel) != null);
  const byScore = [...all].sort((a, b) => scoreOf(a) - scoreOf(b));
  const reachableByScore = byScore.filter((s) => s.kmAlong <= limitKm);

  // Show the 6 best stops for the strategy — but when a stop is mandatory,
  // guarantee the best reachable ones are among them (a list of stations past
  // the autonomy limit would be useless).
  const MAX_SHOWN = 6;
  const chosen = new Set<RouteStation>(byScore.slice(0, MAX_SHOWN));
  if (needsStop) {
    for (const s of reachableByScore.slice(0, 2)) {
      if (chosen.has(s)) continue;
      const worstDroppable = [...chosen]
        .filter((c) => c.kmAlong > limitKm)
        .sort((a, b) => scoreOf(b) - scoreOf(a))[0];
      if (worstDroppable) chosen.delete(worstDroppable);
      chosen.add(s);
    }
  }
  const stops = [...chosen].sort((a, b) => a.kmAlong - b.kmAlong);

  const withPrice = all;
  const reco: RouteStation | null = reachableByScore[0] ?? byScore[0] ?? null;

  let recoSub = '';
  if (reco && withPrice.length > 1) {
    const maxP = Math.max(...withPrice.map(priceOf));
    const save = (maxP - priceOf(reco)) * tank;
    if (routeMode === 'prix') {
      recoSub = `Prix le plus bas du trajet : −${save.toFixed(2).replace('.', ',')} €`;
    } else if (routeMode === 'detour') {
      recoSub =
        reco.detourMin === 0
          ? 'Sur votre route · sans détour'
          : `Détour minimal · +${reco.detourMin} min`;
    } else {
      recoSub = `Le plein ici : −${save.toFixed(2).replace('.', ',')} € vs le + cher du trajet`;
    }
  } else if (reco) {
    recoSub = 'Seule station trouvée sur le trajet';
  }

  // Tour selections survive strategy switches even if the stop leaves the top-6
  const tourStops = all.filter((s) => tour[s.id]);

  // Trip fuel volume + cost, from the configured average consumption
  let tripLitres: number | null = null;
  let tripCost: number | null = null;
  if (route) {
    tripLitres = (route.distanceKm * app.conso) / 100;
    const refPrice = reco
      ? priceOf(reco)
      : withPrice.length
        ? Math.min(...withPrice.map(priceOf))
        : Infinity;
    if (isFinite(refPrice)) tripCost = tripLitres * refPrice;
  }

  let arrivalLabel = '';
  if (route) {
    const base = route.durationMin;
    if (tourStops.length) {
      const extra = tourStops.reduce((a, s) => a + s.detourMin + REFUEL_MIN, 0);
      const arr = new Date(Date.now() + (base + extra) * 60000);
      const n = tourStops.length;
      arrivalLabel = `avec ${n} arrêt${n > 1 ? 's' : ''} : ${arr.getHours()} h ${String(arr.getMinutes()).padStart(2, '0')} (+${extra} min pleins compris)`;
    } else if (needsStop) {
      arrivalLabel = `sans arrêt : autonomie insuffisante (limite ≈ KM ${limitKm})`;
    } else {
      const arr = new Date(Date.now() + base * 60000);
      arrivalLabel = `arrivée estimée ${arr.getHours()} h ${String(arr.getMinutes()).padStart(2, '0')} · autonomie OK`;
    }
  }

  return {
    stops,
    recoId: reco?.id ?? null,
    recoSub,
    limitKm,
    autonomyKm,
    needsStop,
    arrivalLabel,
    tourStops,
    tripLitres,
    tripCost,
  };
}
