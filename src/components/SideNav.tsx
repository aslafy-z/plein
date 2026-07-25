import { C } from '../theme';
import { APP_VERSION } from '../lib/appUpdate';
import { m } from '../paraglide/messages.js';
import { LogoLockup } from './Logo';
import { useApp } from '../state/store';
import { TABS, TabIcon, tabIsActive, tabLabel, tabTarget } from './NavBar';

/**
 * Desktop navigation: a rail down the side, always visible.
 *
 * The bottom tab bar is a phone shape. On a window it takes the edge the
 * thumb can reach and no cursor ever visits, spends the full width on four
 * buttons, and leaves the top-left — where a desktop user looks for both the
 * product name and the sections — empty. The rail puts all three there, and
 * the labels ride next to the pictos instead of under them, so the tabs read
 * as a list rather than a toolbar.
 *
 * The bottom of the rail carries the app-level footer a desktop window has
 * room for: the install offer (a full-width banner on a phone), the
 * geolocation notice, and the running version. App-level state, not map
 * controls — nothing of this covers the map.
 */
export default function SideNav() {
  const app = useApp();

  const geoOff = app.geoStatus === 'denied' || app.geoStatus === 'unavailable';

  return (
    <nav
      style={{
        width: 208,
        flexShrink: 0,
        background: C.navBg,
        borderRight: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '18px 12px 14px',
      }}
    >
      {/* The wordmark doubles as the way home, as it does on any website */}
      <button
        onClick={() => app.go('map')}
        aria-label={m.nav_home_aria()}
        style={{ display: 'flex', padding: '2px 8px 22px', cursor: 'pointer' }}
      >
        <LogoLockup tile={32} glyph={21} fontSize={16} />
      </button>

      {TABS.map((tab) => {
        const active = tabIsActive(tab, app.screen);
        return (
          <button
            key={tab}
            onClick={() => app.go(tabTarget(tab, app.routeReady))}
            aria-current={active ? 'page' : undefined}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '11px 12px',
              borderRadius: 12,
              background: active ? C.accentSoft15 : 'transparent',
              color: active ? C.accent : C.mut,
              fontSize: 14,
              fontWeight: active ? 800 : 600,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {/* The active tab hangs its bar on the rail's edge, outside the
                rounded background — a stronger mark than the tint alone */}
            {active && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -12,
                  top: 9,
                  bottom: 9,
                  width: 3,
                  borderRadius: '0 2px 2px 0',
                  background: C.accent,
                }}
              />
            )}
            {/* Fixed picto column: the four glyphs have different widths and
                the labels must still line up */}
            <span
              style={{
                width: 18,
                display: 'flex',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <TabIcon tab={tab} color={active ? C.accent : C.faint} size={17} />
            </span>
            {tabLabel(tab)}
          </button>
        );
      })}

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          paddingTop: 16,
        }}
      >
        {geoOff && (
          <button
            onClick={() => app.requestGeolocation()}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: C.mut,
              textAlign: 'left',
              lineHeight: 1.4,
              padding: '0 8px',
              cursor: 'pointer',
            }}
          >
            {app.hasKnownPos ? m.map_geo_last_known() : m.map_geo_default_pos()}
          </button>
        )}

        {app.installBannerVisible && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => app.promptInstall()}
              title={m.install_pitch()}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                fontWeight: 700,
                color: C.accent,
                border: `1px solid ${C.accentBorder}`,
                borderRadius: 12,
                padding: '9px 10px',
                textAlign: 'center',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {m.install_action()}
            </button>
            <button
              onClick={() => app.dismissInstallBanner()}
              aria-label={m.install_dismiss_aria()}
              title={m.install_dismiss_aria()}
              style={{ color: C.mut, fontSize: 13, fontWeight: 700, padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
        )}

        <div style={{ fontSize: 11, color: C.ghost, padding: '0 8px' }}>v{APP_VERSION}</div>
      </div>
    </nav>
  );
}
