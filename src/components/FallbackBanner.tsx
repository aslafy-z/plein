import { useApp } from '../state/store';
import { useIsOnline } from '../lib/connectivity';
import { m } from '../paraglide/messages.js';
import { C } from '../theme';

/**
 * Standing notice when the stations on screen could not be refreshed: the app
 * keeps showing what it has and owns up to why, with a manual retry (the
 * store also revalidates on its own when connectivity returns).
 */
export default function FallbackBanner() {
  const app = useApp();
  const online = useIsOnline();
  const { stations, screen } = app;
  if (screen === 'onboarding') return null;
  if (stations.lastError == null) return null;

  // The failure kind was recorded when the fetch failed; the live `offline`
  // reading covers connectivity lost since then.
  const offline = !online || stations.lastError === 'offline';
  return (
    <div
      style={{
        background: 'rgba(224,122,95,.12)',
        borderBottom: '1px solid rgba(224,122,95,.3)',
        color: '#e8b3a4',
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
      <span style={{ flex: 1 }}>{offline ? m.banner_offline() : m.banner_source_down()}</span>
      <button
        onClick={() => app.reloadStations()}
        style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
      >
        {m.banner_retry()}
      </button>
    </div>
  );
}
