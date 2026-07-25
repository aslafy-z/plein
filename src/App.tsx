import { useApp, type Screen } from './state/store';
import { useIsDesktop } from './lib/layout';
import Onboarding from './screens/Onboarding';
import MapScreen from './screens/MapScreen';
import FavoritesScreen from './screens/FavoritesScreen';
import RouteSetup from './screens/RouteSetup';
import RouteRibbon from './screens/RouteRibbon';
import Settings from './screens/Settings';
import StationDetail from './screens/StationDetail';
import FiltersSheet from './screens/FiltersSheet';
import NavBar from './components/NavBar';
import SideNav from './components/SideNav';
import Toast from './components/Toast';
import FallbackBanner from './components/FallbackBanner';
import InstallPrompt from './components/InstallPrompt';
import UpdatePrompt from './components/UpdatePrompt';

/** Screens the tab bar / side navigation belongs on */
const NAV_SCREENS: Screen[] = ['map', 'favs', 'route', 'routeSetup', 'settings'];

export default function App() {
  const app = useApp();
  const { screen } = app;
  const desktop = useIsDesktop();

  // A fiche takes the whole phone screen, tab bar included — there is nothing
  // else to look at on 400px. A window keeps the side navigation up: the fiche
  // is one page of the app, not a mode the user has to back out of blind.
  const showTabBar = !desktop && NAV_SCREENS.includes(screen);
  const showSideNav = desktop && (NAV_SCREENS.includes(screen) || screen === 'detail');

  return (
    <div className="app-viewport">
      {/* Column under the tab bar, row beside the side navigation — one source
          of truth for which arrangement is on screen (see lib/layout.ts) */}
      <div className="app-shell" style={{ flexDirection: desktop ? 'row' : 'column' }}>
        {showSideNav && <SideNav />}
        <div className="app-main">
          <UpdatePrompt />
          <FallbackBanner />
          <InstallPrompt />
          {screen === 'onboarding' && <Onboarding />}
          {screen === 'map' && <MapScreen />}
          {screen === 'favs' && <FavoritesScreen />}
          {screen === 'routeSetup' && <RouteSetup />}
          {screen === 'route' && <RouteRibbon />}
          {screen === 'settings' && <Settings />}
          {showTabBar && <NavBar />}
          {/* Last so the phone's full-screen fiche covers the tab bar above;
              on desktop it is simply the content of the region */}
          {screen === 'detail' && <StationDetail />}
        </div>
        {app.filtersOpen && <FiltersSheet />}
        <Toast />
      </div>
    </div>
  );
}
