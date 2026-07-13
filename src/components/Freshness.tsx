// Data-freshness indicator for the station cache:
// – spinning arrow while cached data refreshes in the background
// – amber clock pictogram when the shown prices are outdated
import { useEffect, useReducer } from 'react';
import { C } from '../theme';
import { STALE_MS } from '../data/stationsCache';
import { useApp } from '../state/store';

function ageLabel(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  return `il y a ${Math.round(min / 60)} h`;
}

export default function Freshness() {
  const app = useApp();
  // Re-render periodically so the age label (and staleness) stay truthful
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, []);
  const { status, refreshing, fetchedAt } = app.stations;
  if (status !== 'ready') return null;

  if (refreshing) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 11.5,
          fontWeight: 600,
          color: C.mut,
          whiteSpace: 'nowrap',
        }}
      >
        <span className="spin" style={{ color: C.accent, fontSize: 13 }} aria-hidden>
          ↻
        </span>
        actualisation…
      </span>
    );
  }

  const age = fetchedAt ? Date.now() - fetchedAt : 0;
  if (!fetchedAt || age <= STALE_MS) return null;

  return (
    <button
      onClick={() => app.reloadStations()}
      title="Prix non actualisés — toucher pour recharger"
      aria-label="Recharger les prix"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: C.warn,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        background: 'rgba(224,122,95,.12)',
        padding: '3px 8px',
        borderRadius: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 11,
          height: 11,
          borderRadius: '50%',
          border: `1.5px solid ${C.warn}`,
          position: 'relative',
          display: 'inline-block',
          boxSizing: 'border-box',
        }}
      >
        {/* clock hands */}
        <span
          style={{
            position: 'absolute',
            left: 4,
            top: 2,
            width: 1.5,
            height: 3.5,
            background: C.warn,
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 4,
            top: 4.5,
            width: 3,
            height: 1.5,
            background: C.warn,
          }}
        />
      </span>
      {ageLabel(age)} · ↻
    </button>
  );
}
