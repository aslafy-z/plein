import { useApp } from './state/store';
import Onboarding from './screens/Onboarding';
import MapScreen from './screens/MapScreen';
import ListScreen from './screens/ListScreen';
import RouteSetup from './screens/RouteSetup';
import RouteRibbon from './screens/RouteRibbon';
import Settings from './screens/Settings';
import StationDetail from './screens/StationDetail';
import FiltersSheet from './screens/FiltersSheet';
import NavBar from './components/NavBar';
import Toast from './components/Toast';
import FallbackBanner from './components/FallbackBanner';

export default function App() {
  const app = useApp();
  const { screen } = app;
  const showNav = ['map', 'list', 'route', 'routeSetup', 'settings'].includes(screen);

  return (
    <div className="app-viewport">
      <div className="app-shell">
        <FallbackBanner />
        {screen === 'onboarding' && <Onboarding />}
        {screen === 'map' && <MapScreen />}
        {screen === 'list' && <ListScreen />}
        {screen === 'routeSetup' && <RouteSetup />}
        {screen === 'route' && <RouteRibbon />}
        {screen === 'settings' && <Settings />}
        {showNav && <NavBar />}
        {screen === 'detail' && <StationDetail />}
        {app.filtersOpen && <FiltersSheet />}
        <Toast />
      </div>
    </div>
  );
}
