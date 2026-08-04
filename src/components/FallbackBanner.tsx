import { useApp } from '../state/store';
import { useForcedOffline, useIsOnline } from '../lib/connectivity';
import { m } from '../paraglide/messages.js';
import { C } from '../theme';

/**
 * Standing notice when the stations on screen could not be refreshed: the app
 * keeps showing what it has and owns up to why, with a manual retry (the
 * store also revalidates on its own when connectivity returns).
 *
 * With « Force offline mode » on (Settings › Offline data) the notice stands
 * from the moment the switch flips — the mode is why nothing will refresh, so
 * it must not wait for a failed attempt to say so — and the retry is dropped:
 * an attempt cannot succeed while the switch holds, the way out is Settings.
 */
export default function FallbackBanner() {
  const app = useApp();
  const online = useIsOnline();
  const forced = useForcedOffline();
  const { stations, screen } = app;
  if (screen === 'onboarding') return null;
  if (!forced && stations.lastError == null) return null;

  // The failure kind was recorded when the fetch failed; the live `offline`
  // reading covers connectivity lost since then.
  const offline = !online || stations.lastError === 'offline';
  return (
    <div
      data-testid="fallback-banner"
      style={{
        background: C.warnSoft,
        borderBottom: `1px solid ${C.warnBorder30}`,
        color: C.warnText,
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
      <span style={{ flex: 1 }}>
        {forced
          ? m.banner_forced_offline()
          : offline
            ? m.banner_offline()
            : m.banner_source_down()}
      </span>
      {!forced && (
        <button
          onClick={() => app.reloadStations()}
          style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
        >
          {m.banner_retry()}
        </button>
      )}
    </div>
  );
}
