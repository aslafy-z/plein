import { useApp, selectFocusStation, selectRecommended } from '../state/store';
import ZoneCard from './ZoneCard';
import ZoneList from './ZoneList';

/**
 * The zone floating over the map — the DESKTOP arrangement.
 *
 * Same card and same list as the phone's bottom sheet (ZoneCard / ZoneList),
 * minus the gesture. MapScreen owns the slot this fills (position, width,
 * glass surface — see floatingPanelStyle in theme.ts); the panel itself is
 * only the content, transparent over the glass. With a fiche open under the
 * list, `listOnly` drops the leading card: the fiche IS the lead then, and
 * the card would repeat it a few pixels above.
 */
export default function ZonePanel({ listOnly = false }: { listOnly?: boolean }) {
  const app = useApp();
  // Nothing to lead with (loading, or no station passes the filters) → the
  // card says so on its own and there is no list to put under it
  const hasCard = (selectFocusStation(app) ?? selectRecommended(app)) != null;

  return (
    <aside
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {!listOnly && (
        <div style={{ flexShrink: 0 }}>
          <ZoneCard />
        </div>
      )}
      {hasCard && <ZoneList />}
    </aside>
  );
}
