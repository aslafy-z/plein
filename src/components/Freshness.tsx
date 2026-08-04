// Data-freshness indicator for the station cache:
// – spinning arrow while cached data refreshes in the background
// – amber clock pictogram when the shown prices are outdated
import { useEffect, useReducer } from 'react';
import { C } from '../theme';
import { freshnessLevel } from '../data/stationsCache';
import { agoLabelFrom, dayMonthLabel } from '../lib/format';
import { m } from '../paraglide/messages.js';
import { useApp } from '../state/store';

export default function Freshness() {
  const app = useApp();
  // Re-render periodically so the age label (and staleness) stay truthful
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, []);
  const { status, refreshing, fetchedAt, lastError } = app.stations;
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
        {m.freshness_refreshing()}
      </span>
    );
  }

  // A standing failure makes ANY age worth flagging: the next refresh is not
  // coming on its own schedule, so the chip owns up even under STALE_MS — but
  // then it has to SAY the refresh failed. « à l'instant » under a banner
  // announcing the source is down reads as reassurance, which is the one thing
  // the chip must never be.
  const level = freshnessLevel(fetchedAt, lastError != null);
  if (level === 'fresh' || !fetchedAt) return null;

  const day = dayMonthLabel(fetchedAt);
  const age = agoLabelFrom(fetchedAt);

  return (
    <button
      onClick={() => app.reloadStations()}
      title={
        lastError != null
          ? m.freshness_offline()
          : level === 'dated'
            ? m.freshness_old_title({ date: day })
            : m.freshness_stale_title()
      }
      aria-label={m.freshness_reload_aria()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: C.warn,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        background: C.warnSoft,
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
      {level === 'dated'
        ? m.freshness_old({ date: day })
        : level === 'unrefreshed'
          ? m.freshness_not_refreshed({ age })
          : m.freshness_age({ age })}
    </button>
  );
}
