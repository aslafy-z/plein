import { C } from '../theme';
import { PANEL_WIDTH } from '../lib/layout';
import { useApp, selectFocusStation, selectRecommended } from '../state/store';
import ZoneCard from './ZoneCard';
import ZoneList from './ZoneList';

/**
 * The zone docked beside the map — the DESKTOP arrangement.
 *
 * Same card and same list as the phone's bottom sheet (ZoneCard / ZoneList),
 * minus the gesture. A window has room for the map and the results at once,
 * so nothing has to be pulled up and nothing overlays the map: Leaflet gets
 * its true size from this flex row instead of being told to keep a strip
 * free at the bottom, which is why MapScreen hands it `bottomInset={0}` here.
 */
export default function ZonePanel() {
  const app = useApp();
  // Nothing to lead with (loading, or no station passes the filters) → the
  // card says so on its own and there is no list to put under it
  const hasCard = (selectFocusStation(app) ?? selectRecommended(app)) != null;

  return (
    <aside
      style={{
        width: PANEL_WIDTH,
        flexShrink: 0,
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <ZoneCard />
      </div>
      {hasCard && <ZoneList />}
    </aside>
  );
}
