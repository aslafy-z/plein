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

// ── Constants ────────────────────────────────────────────────────────────────
/** Lyon Confluence — default position when geolocation is unavailable */
export const DEFAULT_POS: GeoPoint = { lat: 45.7406, lng: 4.8156 };
export const DEFAULT_FROM_LABEL = 'Lyon Confluence';
export const MAX_RADIUS_KM = 25;
/** Average consumption used for autonomy estimates (L/100 km) */
const CONSUMPTION_L_100KM = 6.5;
/** Narrative: you leave with ~70 % tank */
const START_TANK_PCT = 0.7;
/** € value of one minute of detour, for the « compromis » strategy */
const EUR_PER_DETOUR_MIN = 0.35;
/** Minutes spent actually refuelling at a stop */
const REFUEL_MIN = 4;

export type Screen =
  | 'onboarding'
  | 'map'
  | 'list'
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
  tank: number;
  radius: number;
  sourceId: DataSourceId;
  onboarded: boolean;
  alerts: boolean;
  bgloc: boolean;
  recents: { label: string; sublabel: string; point: GeoPoint }[];
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

/** Default recent destinations (also serve as demo route targets) */
export const DEFAULT_RECENTS: PersistedSettings['recents'] = [
  { label: 'Bordeaux centre', sublabel: '543 km · fait le 2 juil.', point: { lat: 44.8378, lng: -0.5792 } },
  { label: 'Paris 15e', sublabel: '465 km · fait le 18 juin', point: { lat: 48.8412, lng: 2.3003 } },
  { label: 'Annecy', sublabel: '142 km · fait le 5 juin', point: { lat: 45.8992, lng: 6.1294 } },
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
  brandCats: Record<'gs' | 'ind' | 'pet', boolean>;
  toggleBrandCat(k: 'gs' | 'ind' | 'pet'): void;
  serviceTags: Partial<Record<ServiceTag, boolean>>;
  toggleServiceTag(t: ServiceTag): void;
  filtersOpen: boolean;
  setFiltersOpen(open: boolean): void;
  resetFilters(): void;

  // stations around me
  userPos: GeoPoint;
  geoStatus: 'pending' | 'granted' | 'denied' | 'unavailable';
  requestGeolocation(): void;
  stations: StationsState;
  reloadStations(): void;

  // route
  fromText: string;
  toText: string;
  fromPoint: GeoPoint | null;
  toPoint: GeoPoint | null;
  setFrom(text: string, point?: GeoPoint | null): void;
  setTo(text: string, point?: GeoPoint | null): void;
  searchPlaces(q: string): Promise<GeocodeResult[]>;
  recents: PersistedSettings['recents'];
  routeReady: boolean;
  startRoute(): void;
  editRoute(): void;
  routeMode: RouteMode;
  setRouteMode(m: RouteMode): void;
  routeState: RouteState;
  tour: Record<string, boolean>;
  toggleTour(id: string): void;

  // settings
  tank: number;
  setTank(t: number): void;
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

  // onboarding
  finishOnboarding(withGeoloc: boolean): void;
}

const Ctx = createContext<AppStore | null>(null);

// ── Provider component ───────────────────────────────────────────────────────
export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useRef(loadPersisted()).current;

  const [screen, setScreen] = useState<Screen>(persisted.onboarded ? 'map' : 'onboarding');
  const [prevScreen, setPrevScreen] = useState<Screen>('map');
  const [fuel, setFuelState] = useState<FuelId>(persisted.fuel ?? 'gazole');
  const [sort, setSort] = useState<SortMode>('prix');
  const [radius, setRadiusState] = useState<number>(persisted.radius ?? 5);
  const [brandCats, setBrandCats] = useState({ gs: true, ind: true, pet: true });
  const [serviceTags, setServiceTags] = useState<Partial<Record<ServiceTag, boolean>>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>('compromis');
  const [tour, setTour] = useState<Record<string, boolean>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fromText, setFromText] = useState(DEFAULT_FROM_LABEL);
  const [toText, setToText] = useState('');
  const [fromPoint, setFromPoint] = useState<GeoPoint | null>(DEFAULT_POS);
  const [toPoint, setToPoint] = useState<GeoPoint | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const [tank, setTankState] = useState<number>(persisted.tank ?? 50);
  const [alerts, setAlertsState] = useState<boolean>(persisted.alerts ?? true);
  const [bgloc, setBglocState] = useState<boolean>(persisted.bgloc ?? false);
  const [sourceId, setSourceIdState] = useState<DataSourceId>(persisted.sourceId ?? 'gouv');
  const [toast, setToast] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<GeoPoint>(DEFAULT_POS);
  const [geoStatus, setGeoStatus] = useState<AppStore['geoStatus']>('pending');
  const [recents] = useState(persisted.recents ?? DEFAULT_RECENTS);
  const [stations, setStations] = useState<StationsState>({
    status: 'idle',
    data: [],
    activeSource: sourceId,
    fellBack: false,
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
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus('granted');
      },
      () => setGeoStatus('denied'),
      { timeout: 8000, maximumAge: 120000 },
    );
  }, []);

  // Returning users skipped onboarding → ask for the real position on mount
  useEffect(() => {
    if (persisted.onboarded) requestGeolocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stations near me (fetch at MAX radius, filter client-side) ─────────────
  const stationsReq = useRef(0);
  const loadStations = useCallback(async () => {
    const reqId = ++stationsReq.current;
    setStations((s) => ({ ...s, status: 'loading' }));
    const bundle = getProviders(sourceId);
    try {
      const data = await bundle.stations.getStationsNear(userPos, MAX_RADIUS_KM);
      if (reqId !== stationsReq.current) return;
      setStations({ status: 'ready', data, activeSource: sourceId, fellBack: false });
    } catch {
      // Real source down → substitute demo data, visibly.
      if (reqId !== stationsReq.current) return;
      if (sourceId !== 'demo') {
        try {
          const demo = await getProviders('demo').stations.getStationsNear(userPos, MAX_RADIUS_KM);
          if (reqId !== stationsReq.current) return;
          setStations({ status: 'ready', data: demo, activeSource: 'demo', fellBack: true });
          return;
        } catch {
          /* fall through */
        }
      }
      if (reqId !== stationsReq.current) return;
      setStations({ status: 'error', data: [], activeSource: sourceId, fellBack: false });
    }
  }, [sourceId, userPos]);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  // ── Route computation ──────────────────────────────────────────────────────
  const routeReq = useRef(0);
  const computeRoute = useCallback(
    async (from: GeoPoint, to: GeoPoint) => {
      const reqId = ++routeReq.current;
      setRouteState((s) => ({ ...s, status: 'loading' }));
      const run = async (src: DataSourceId) => {
        const bundle = getProviders(src);
        const route = await bundle.route.getRoute(from, to);
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
        // Keep the ribbon readable: at most 6 stops, best-priced first when trimming
        const trimmed =
          enriched.length <= 6
            ? enriched
            : [...enriched]
                .sort((a, b) => (a.prices[fuel]?.value ?? 9) - (b.prices[fuel]?.value ?? 9))
                .slice(0, 6)
                .sort((a, b) => a.kmAlong - b.kmAlong);
        return { route, stations: trimmed };
      };
      try {
        const res = await run(sourceId);
        if (reqId !== routeReq.current) return;
        setRouteState({ status: 'ready', ...res, fellBack: false });
      } catch {
        if (reqId !== routeReq.current) return;
        if (sourceId !== 'demo') {
          try {
            const res = await run('demo');
            if (reqId !== routeReq.current) return;
            setRouteState({ status: 'ready', ...res, fellBack: true });
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
    [sourceId, fuel],
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

  const back = useCallback(() => setScreen(prevScreen), [prevScreen]);

  const setFuel = useCallback((f: FuelId) => {
    setFuelState(f);
    savePersisted({ fuel: f });
  }, []);

  const cycleFuel = useCallback(() => {
    setFuelState((cur) => {
      // Quick-cycle the three main fuels; a non-main fuel (SP98, GPLc…)
      // stays in the loop instead of being silently dropped.
      const main: FuelId[] = ['gazole', 'e10', 'e85'];
      const order: FuelId[] = main.includes(cur) ? main : [...main, cur];
      const idx = order.indexOf(cur);
      const next = order[(idx + 1) % order.length];
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

  const resetFilters = useCallback(() => {
    setRadius(5);
    setBrandCats({ gs: true, ind: true, pet: true });
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
        if (r[0]) setToText(r[0].label);
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
    void computeRoute(from, to);
  }, [computeRoute, fromPoint, fromText, showToast, sourceId, toPoint, toText, userPos]);

  const editRoute = useCallback(() => setScreen('routeSetup'), []);

  const toggleTour = useCallback((id: string) => {
    setTour((t) => ({ ...t, [id]: !t[id] }));
  }, []);

  const openInMaps = useCallback(
    (target: Station) => {
      showToast('Ouverture de Google Maps…');
      const url = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
      window.open(url, '_blank', 'noopener');
    },
    [showToast],
  );

  const openTourInMaps = useCallback(() => {
    const stops = routeState.stations.filter((s) => tour[s.id]);
    if (!stops.length || !toPoint) return;
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
      brandCats,
      toggleBrandCat: (k) => setBrandCats((b) => ({ ...b, [k]: !b[k] })),
      serviceTags,
      toggleServiceTag: (t) => setServiceTags((s) => ({ ...s, [t]: !s[t] })),
      filtersOpen,
      setFiltersOpen,
      resetFilters,
      userPos,
      geoStatus,
      requestGeolocation,
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
      routeReady,
      startRoute: () => void startRoute(),
      editRoute,
      routeMode,
      setRouteMode,
      routeState,
      tour,
      toggleTour,
      tank,
      setTank,
      alerts,
      setAlerts,
      bgloc,
      setBgloc,
      sourceId,
      setSourceId,
      detailId,
      toast,
      notify: showToast,
      openInMaps,
      openTourInMaps,
      finishOnboarding,
    }),
    [
      screen, prevScreen, go, back, openStation, fuel, setFuel, cycleFuel, sort, radius, setRadius,
      brandCats, serviceTags, filtersOpen, resetFilters, userPos, geoStatus,
      requestGeolocation, stations, loadStations, fromText, toText, fromPoint, toPoint,
      setFrom, setTo, searchPlaces, recents, routeReady, startRoute, editRoute,
      routeMode, routeState, tour, toggleTour, tank, setTank, alerts, setAlerts,
      bgloc, setBgloc, sourceId, setSourceId, detailId, toast, showToast,
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
  const { stations, userPos, radius, brandCats, serviceTags } = app;
  const wantedTags = (Object.keys(serviceTags) as ServiceTag[]).filter((t) => serviceTags[t]);
  const brandFilterActive = app.stations.data.some((s) => s.cat !== 'unknown');
  return stations.data
    .map((s) => {
      const distKm = haversineKm(userPos, { lat: s.lat, lng: s.lng });
      return { ...s, distKm, driveMin: Math.max(1, Math.round(distKm * 2)) };
    })
    .filter(
      (s) =>
        s.distKm <= radius &&
        s.prices[fuel] != null &&
        (!brandFilterActive || s.cat === 'unknown' || brandCats[s.cat as 'gs' | 'ind' | 'pet']) &&
        wantedTags.every((t) => s.tags.includes(t)),
    );
}

/** Stations passing the current filters, for the currently selected fuel */
export function selectVisible(app: AppStore): NearbyStation[] {
  return selectVisibleForFuel(app, app.fuel);
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
  const autonomyKm = Math.round(((app.tank * START_TANK_PCT) / CONSUMPTION_L_100KM) * 100);
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
}

/** Everything the route ribbon needs, computed from real data */
export function selectRouteAnalysis(app: AppStore): RouteAnalysis {
  const { routeState, routeMode, fuel, tank, tour } = app;
  const { limitKm, autonomyKm } = selectAutonomy(app);
  const stops = routeState.stations;
  const route = routeState.route;
  const needsStop = !!route && route.distanceKm > limitKm;

  const priceOf = (s: RouteStation) => s.prices[fuel]?.value ?? Infinity;
  const withPrice = stops.filter((s) => s.prices[fuel] != null);
  const reachable = withPrice.filter((s) => s.kmAlong <= limitKm);
  const pool = reachable.length ? reachable : withPrice;

  let reco: RouteStation | null = null;
  if (pool.length) {
    if (routeMode === 'prix') {
      reco = [...pool].sort((a, b) => priceOf(a) - priceOf(b))[0];
    } else if (routeMode === 'detour') {
      reco = [...pool].sort(
        (a, b) => a.detourMin - b.detourMin || priceOf(a) - priceOf(b),
      )[0];
    } else {
      reco = [...pool].sort(
        (a, b) =>
          priceOf(a) * tank + a.detourMin * EUR_PER_DETOUR_MIN -
          (priceOf(b) * tank + b.detourMin * EUR_PER_DETOUR_MIN),
      )[0];
    }
  }

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

  const tourStops = stops.filter((s) => tour[s.id]);

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
  };
}
