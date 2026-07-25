import { useApp } from '../state/store';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { C } from '../theme';

/**
 * Offer to add the app to the home screen — the PHONE arrangement.
 *
 * It used to ride the map's floating control column, tucked under the search
 * field and right-aligned: it covered the map it was offering to install, and
 * once that column was capped so it wouldn't stretch across a window, the chip
 * ended up floating in the middle of nothing. Installing is an app-level offer,
 * not a map control — so it sits with the other app-level notices (a new build
 * available, a data source that fell back) at the top of the screen, in the
 * same bar shape. On desktop the offer lives at the bottom of the side rail
 * instead (see SideNav): a window has permanent chrome for it, and a bar
 * across the whole region was the loudest thing on every screen.
 */
export default function InstallPrompt() {
  const app = useApp();
  const desktop = useIsDesktop();
  // Never during the walkthrough: someone who hasn't seen the map yet has no
  // reason to install anything (same rule as the fallback banner)
  if (desktop || !app.installBannerVisible || app.screen === 'onboarding') return null;

  return (
    <div
      style={{
        background: C.accentSoft09,
        borderBottom: `1px solid ${C.accentBorder}`,
        color: C.body,
        fontSize: 12,
        fontWeight: 600,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        zIndex: 40,
      }}
    >
      <span style={{ flex: 1 }}>{m.install_pitch()}</span>
      <button
        onClick={() => app.promptInstall()}
        style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        {m.install_action()}
      </button>
      <button
        onClick={() => app.dismissInstallBanner()}
        aria-label={m.install_dismiss_aria()}
        title={m.install_dismiss_aria()}
        style={{ color: C.mut, fontWeight: 700, fontSize: 13, padding: '0 2px', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}
