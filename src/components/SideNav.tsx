import { C } from '../theme';
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
 */
export default function SideNav() {
  const app = useApp();

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
        padding: '18px 12px',
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
    </nav>
  );
}
