// Place search on the map tab. Picking a result MOVES THE SEARCH CIRCLE there
// (stations reload around it) — it does not start a route. Each suggestion
// also offers a secondary « Directions › » shortcut that pre-fills the route
// setup for people who did want directions.
//
// The field itself — debounce, spinner, history rows, dropdown on a window,
// full screen on a phone — is PlaceField, shared with the route's departure
// and arrival fields. What stays here is the map's own policy: the collapsed
// pill showing the searched place (clearable back to « my position »), the
// `setSearchArea` side effect, and the route shortcut per row.
import { C } from '../theme';
import { m } from '../paraglide/messages.js';
import type { GeocodeResult } from '../data/types';
import { useApp } from '../state/store';
import PlaceField from './PlaceField';

export default function PlaceSearch() {
  const app = useApp();
  // Open/closed is NAV state, not the panel's own: on a phone the search is a
  // screen, and the system Back has to close it rather than leave the map.
  const open = app.searchOpen === 'area';

  // No padding of its own: the buttons inside carry it, so the whole box is
  // clickable and the focus ring wraps the box (`.search-box` in styles.css).
  const barStyle = {
    display: 'flex',
    alignItems: 'center',
    background: C.surface2,
    border: `1px solid ${C.border09}`,
    borderRadius: 28,
    boxShadow: `0 8px 24px ${C.shadow40}`,
    pointerEvents: 'auto' as const,
    width: '100%',
  };

  const pinIcon = (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: `2.5px solid ${C.mut}`,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -5,
          bottom: -4,
          width: 8,
          height: 2.5,
          background: C.mut,
          borderRadius: 2,
          transform: 'rotate(45deg)',
        }}
      />
    </div>
  );

  if (!open) {
    // Collapsed: current searched place (clearable in-bar) or the search prompt
    return (
      <div className="search-box" style={barStyle}>
        <button
          className="search-box-hit"
          onClick={() => app.setSearchOpen('area')}
          aria-label={m.search_open_aria()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: 1,
            minWidth: 0,
            padding: app.searchLabel ? '14px 6px 14px 18px' : '14px 18px',
          }}
        >
          {pinIcon}
          <span
            style={{
              color: app.searchLabel ? C.ink : C.mut,
              fontSize: 15,
              fontWeight: app.searchLabel ? 600 : 400,
              flex: 1,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {app.searchLabel ?? m.search_prompt()}
          </span>
        </button>
        {app.searchLabel && (
          <button
            onClick={() => app.resetSearchToUser()}
            aria-label={m.search_reset_aria()}
            style={{
              flexShrink: 0,
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              color: C.mut,
              fontSize: 16,
              fontWeight: 700,
              padding: '0 16px 0 6px',
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  // Picking a result moves the search circle; the field itself remembers the
  // place and closes. The route shortcut leaves the search behind on its own
  // history entry, so Back out of the route setup returns to it.
  const pickArea = (r: GeocodeResult) => {
    app.setSearchArea(r.point, r.label);
  };
  const pickRoute = (r: GeocodeResult) => {
    app.setTo(r.label, r.point);
    app.go('routeSetup');
  };

  return (
    <PlaceField
      target="area"
      value=""
      placeholder={m.search_placeholder()}
      icon={pinIcon}
      autoFocus
      onPick={pickArea}
      onClose={() => app.setSearchOpen(null)}
      rowAction={{
        label: m.search_route_shortcut(),
        aria: (place) => m.search_route_to_aria({ place }),
        pick: pickRoute,
      }}
      rowHint={m.search_see_stations_here()}
      emptyHint={m.search_hint()}
    />
  );
}
