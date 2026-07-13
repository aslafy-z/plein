import { C, mono } from '../theme';
import { fmtPrice, distLabel, plural } from '../lib/format';
import { openStatus } from '../lib/hours';
import Freshness from '../components/Freshness';
import { ALL_FUELS, FUEL_LABELS } from '../data/types';
import {
  useApp,
  selectSorted,
  selectCheapest,
  selectPriceRange,
} from '../state/store';

export default function ListScreen() {
  const app = useApp();
  const { radius, fuel, sort, tank } = app;

  const rows = selectSorted(app);
  const cheapest = selectCheapest(app);
  const range = selectPriceRange(app);
  const min = range ? range.min : 0;
  const max = range ? range.max : 0;
  const span = max - min;
  const save = range ? (max - min) * tank : 0;

  const loading = app.stations.status === 'loading' || app.stations.status === 'idle';
  const isEmpty = !loading && rows.length === 0;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '14px 20px 0' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: C.ink, flex: 1 }}>
            Autour de vous
          </span>
          <button
            onClick={() => app.setFiltersOpen(true)}
            style={{ fontSize: 13, color: C.mut, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Rayon {radius} km ›
          </button>
        </div>

        {/* Fuel tabs */}
        <div
          style={{
            display: 'flex',
            background: C.surface,
            borderRadius: 22,
            padding: 4,
            marginTop: 14,
            border: `1px solid ${C.border}`,
            overflowX: 'auto',
          }}
        >
          {ALL_FUELS.map((f) => {
            const active = f === fuel;
            return (
              <button
                key={f}
                onClick={() => app.setFuel(f)}
                style={{
                  flex: '1 0 auto',
                  padding: '9px 12px',
                  textAlign: 'center',
                  background: active ? C.accent : 'transparent',
                  color: active ? C.onAccent : C.body,
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 18,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {FUEL_LABELS[f]}
              </button>
            );
          })}
        </div>

        {/* Hero savings card */}
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.accentBorder}`,
            borderRadius: 18,
            padding: '16px 20px',
            marginTop: 14,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: C.accent,
              marginBottom: 6,
            }}
          >
            Votre économie possible
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ font: mono(700, 32), color: C.accent, whiteSpace: 'nowrap' }}>
              {fmtPrice(save)} €
            </span>
            <span style={{ fontSize: 13, color: C.mut }}>sur un plein de {tank} L</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.faint, marginTop: 4 }}>
            écart entre la station la + chère et la − chère dans le rayon
          </div>
        </div>

        {/* Count + sort */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 16,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: C.mut,
            }}
          >
            {plural(rows.length, 'station')}
          </span>
          <span style={{ flex: 1 }}>
            <Freshness />
          </span>
          {([['prix', 'Prix'], ['dist', 'Distance']] as const).map(([k, label]) => {
            const active = sort === k;
            return (
              <button
                key={k}
                onClick={() => app.setSort(k)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: active ? C.onAccent : C.mut,
                  background: active ? C.accent : C.surface2,
                  padding: '6px 12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows / states */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 18px' }}>
        {loading &&
          [0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                background: C.surface,
                borderRadius: 16,
                padding: '14px 16px',
                border: `1px solid ${C.border}`,
                opacity: 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: C.surface3, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ width: '55%', height: 12, borderRadius: 6, background: C.surface3 }} />
                  <div style={{ width: '35%', height: 10, borderRadius: 5, background: C.surface3, marginTop: 8 }} />
                </div>
                <div style={{ width: 56, height: 18, borderRadius: 6, background: C.surface3 }} />
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.surface3, marginTop: 12 }} />
            </div>
          ))}

        {isEmpty && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              padding: '40px 20px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>
              Aucune station ne correspond à vos filtres.
            </span>
            <button
              onClick={() => app.setFiltersOpen(true)}
              style={{ fontSize: 14, fontWeight: 700, color: C.accent, cursor: 'pointer' }}
            >
              Ajuster les filtres
            </button>
          </div>
        )}

        {!loading &&
          rows.map((s) => {
            const best = cheapest != null && s.id === cheapest.id;
            const price = s.prices[fuel]!.value;
            const delta = price - min;
            const bar = span < 0.001 ? 40 : 18 + (delta / span) * 70;
            return (
              <button
                key={s.id}
                onClick={() => app.openStation(s.id)}
                style={{
                  background: C.surface,
                  borderRadius: 16,
                  padding: '14px 16px',
                  border: best ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`,
                  cursor: 'pointer',
                  display: 'block',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: C.surface3,
                      color: C.mut,
                      fontWeight: 800,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {s.init}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{s.name}</div>
                    <div style={{ fontSize: 12.5, color: C.mut, marginTop: 1 }}>
                      {[`${distLabel(s.distKm)} · à ${s.driveMin} min`, openStatus(s.hours)?.short]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div
                      style={{
                        font: mono(700, 20),
                        color: best ? C.accent : C.ink,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtPrice(price)} €
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: best ? C.accent : delta > 0.12 ? C.warn : C.mut,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {best ? 'meilleur prix' : `+${fmtPrice(delta)}`}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    height: 5,
                    borderRadius: 3,
                    background: C.surface3,
                    marginTop: 12,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(bar)}%`,
                      height: '100%',
                      background: best ? C.accent : delta > 0.12 ? C.warnBar : C.okBar,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
