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
import type { GeoPoint } from '../lib/geo';
import { cumulativeKm, haversineKm, nearestOnPolyline } from '../lib/geo';
import {
  ALL_FUELS,
  type VehicleId,
  type DataSourceId,
  type FuelId,
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
/** Vehicle profile presets (tank L, consumption L/100 km) — adjustable in Réglages */
export const VEHICLE_PRESETS: Record<VehicleId, { tank: number; conso: number }> = {
  car: { tank: 50, conso: 6.5 },
  moto: { tank: 15, conso: 5 },
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
  /** Last position the app was centered on — restored on reload so the
      station cache hits instantly instead of flashing Toulouse/demo data */
  lastPos: GeoPoint;
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
  /** Switch profile and apply its tank/conso presets */
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
    return saved === 'fra' || saved === 'esp' || saved === 'demo' ? saved : 'auto';
  });
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
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        if (!searchMovedRef.current) setSearchPos(p);
        setGeoStatus('granted');
        savePersisted({ lastPos: p });
      },
      () => setGeoStatus('denied'),
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
  const loadStations = useCallback(async () => {
    const reqId = ++stationsReq.current;
    const cached = readStationsCache(sourceId, searchPos, radius);
    if (cached && cached.covers && Date.now() - cached.fetchedAt < STALE_MS) {
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
    void loadStations();
  }, [loadStations]);

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
                .sort((a, b) => (a.prices[fuel]?.value ?? 9) - (b.prices[fuel]?.value ?? 9))
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
    savePersisted({ vehicle: v, tank: preset.tank, conso: preset.conso });
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
      const ua = navigator.userAgent;
      // Android: geo: URI → the native maps-app chooser (Google Maps, Waze,
      // Organic Maps…). iOS/iPadOS: Apple Plans universal link (modern iPads
      // report as Macintosh, hence the touch check). Elsewhere: Google Maps.
      const isAndroid = /android/i.test(ua);
      const isIOS =
        /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
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
      if (isAndroid) {
        showToast("Ouverture de l'app GPS…");
        const label = encodeURIComponent(target.name);
        const q = poiQuery ?? `${target.lat},${target.lng}(${label})`;
        window.location.href = `geo:${target.lat},${target.lng}?q=${q}`;
        return;
      }
      if (isIOS) {
        showToast('Ouverture de Plans…');
        window.location.href = `https://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d`;
        return;
      }
      showToast('Ouverture de Google Maps…');
      // Unlike geo:, the dir URL carries no coordinate anchor for a text
      // search — only use it when a street address can disambiguate the query.
      const destination = poiQuery && target.address ? poiQuery : `${target.lat},${target.lng}`;
      const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
      window.open(url, '_blank', 'noopener');
    },
    [showToast],
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
      bgloc, setBgloc, sourceId, setSourceId, detailId, toast, showToast,
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
        s.prices[fuel] != null &&
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
        s.prices[fuel] != null &&
        (brandSel.length === 0 || brandSel.includes(brandGroup(s.brand))) &&
        wantedTags.every((t) => s.tags.includes(t)),
    );
}

export function selectByPrice(app: AppStore): NearbyStation[] {
  const f = app.fuel;
  return [...selectVisible(app)].sort(
    (a, b) => (a.prices[f]?.value ?? 9) - (b.prices[f]?.value ?? 9),
  );
}

export function selectSorted(app: AppStore): NearbyStation[] {
  if (app.sort === 'prix') return selectByPrice(app);
  return [...selectVisible(app)].sort((a, b) => a.distKm - b.distKm);
}

export function selectCheapest(app: AppStore): NearbyStation | null {
  return selectByPrice(app)[0] ?? null;
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

export function selectPriceRange(app: AppStore): { min: number; max: number } | null {
  const byPrice = selectByPrice(app);
  if (!byPrice.length) return null;
  const f = app.fuel;
  return {
    min: byPrice[0].prices[f]!.value,
    max: byPrice[byPrice.length - 1].prices[f]!.value,
  };
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

  const priceOf = (s: RouteStation) => s.prices[fuel]?.value ?? Infinity;
  // Strategy score — the SAME ranking picks the shown stops and the reco,
  // so the strategy chips act on the whole ribbon.
  const scoreOf = (s: RouteStation): number => {
    if (routeMode === 'prix') return priceOf(s);
    if (routeMode === 'detour') return s.detourMin * 1000 + priceOf(s);
    return priceOf(s) * tank + s.detourMin * EUR_PER_DETOUR_MIN;
  };

  const all = routeState.stations.filter((s) => s.prices[fuel] != null);
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
