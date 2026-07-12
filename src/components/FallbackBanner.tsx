import { useApp } from '../state/store';
import { C } from '../theme';

/**
 * Visible notice when the real data source failed and demo data was
 * substituted, or when loading errored entirely.
 */
export default function FallbackBanner() {
  const app = useApp();
  const { stations, routeState, screen } = app;
  if (screen === 'onboarding') return null;

  const fellBack =
    (stations.status === 'ready' && stations.fellBack) ||
    (routeState.status === 'ready' && routeState.fellBack);
  const errored = stations.status === 'error';
  if (!fellBack && !errored) return null;

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
      <span style={{ flex: 1 }}>
        {errored
          ? 'Impossible de charger les stations. Vérifiez votre connexion.'
          : 'Source temps réel indisponible — données de démonstration affichées.'}
      </span>
      <button
        onClick={() => app.reloadStations()}
        style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
      >
        Réessayer
      </button>
    </div>
  );
}
