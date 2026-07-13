import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { FUEL_LABELS, type GeocodeResult } from '../data/types';
import { useApp } from '../state/store';

type Field = 'from' | 'to';

export default function RouteSetup() {
  const app = useApp();
  const { fromText, toText, fuel, tank } = app;

  const [focused, setFocused] = useState<Field | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqId = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const runSearch = (text: string) => {
    clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const id = ++reqId.current;
    timer.current = setTimeout(() => {
      app
        .searchPlaces(text)
        .then((res) => {
          if (id === reqId.current) setSuggestions(res);
        })
        .catch(() => {
          if (id === reqId.current) setSuggestions([]);
        });
    }, 300);
  };

  const onChange = (field: Field, text: string) => {
    if (field === 'from') app.setFrom(text);
    else app.setTo(text);
    setFocused(field);
    runSearch(text);
  };

  const pick = (field: Field, r: GeocodeResult) => {
    if (field === 'from') app.setFrom(r.label, r.point);
    else app.setTo(r.label, r.point);
    setSuggestions([]);
    setFocused(null);
  };

  const canGo = toText.trim().length > 0;

  const dropdown = (field: Field) =>
    focused === field && suggestions.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
        {suggestions.map((r, i) => (
          <button
            key={`${r.label}-${i}`}
            onClick={() => pick(field, r)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: '9px 4px',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{r.label}</span>
            <span style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{r.sublabel}</span>
          </button>
        ))}
      </div>
    ) : null;

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    color: C.ink,
    fontSize: 15,
    fontFamily: 'Archivo, sans-serif',
    padding: 0,
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '16px 20px 20px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>Itinéraire</div>
      <div style={{ fontSize: 13, color: C.mut, marginTop: 4 }}>
        Comparez les prix le long de votre trajet
      </div>

      {/* Inputs card */}
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border08}`,
          borderRadius: 18,
          padding: '6px 16px',
          marginTop: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 0',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: `3px solid ${C.accent}`,
              flexShrink: 0,
            }}
          />
          <input
            type="text"
            value={fromText}
            placeholder="Départ"
            onFocus={() => setFocused('from')}
            onChange={(e) => onChange('from', e.target.value)}
            style={inputStyle}
          />
        </div>
        {dropdown('from')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: C.warn, flexShrink: 0 }} />
          <input
            type="text"
            value={toText}
            placeholder="Destination"
            onFocus={() => setFocused('to')}
            onChange={(e) => onChange('to', e.target.value)}
            style={inputStyle}
          />
        </div>
        {dropdown('to')}
      </div>

      {/* Récents (real trip history) — until then, destination suggestions */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: C.mut,
            marginBottom: 10,
          }}
        >
          {app.hasTripHistory ? 'Récents' : 'Suggestions'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {app.recents.map((r, i) => (
            <button
              key={`${r.label}-${i}`}
              onClick={() => app.setTo(r.label, r.point)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 4px',
                cursor: 'pointer',
                borderRadius: 10,
                width: '100%',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: C.surface2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2.5px solid ${C.mut}` }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{r.label}</div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{r.sublabel}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Info card */}
      <div
        style={{
          background: C.navBg,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '12px 16px',
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, fontSize: 12.5, color: C.mut, lineHeight: 1.45 }}>
          <strong style={{ color: C.ink }}>{FUEL_LABELS[fuel]}</strong> · réservoir {tank} L ·
          modifiable dans Réglages
        </div>
        <button
          onClick={() => app.go('settings')}
          style={{ fontSize: 12.5, fontWeight: 700, color: C.accent, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Réglages ›
        </button>
      </div>

      {/* CTA */}
      <button
        onClick={() => app.startRoute()}
        disabled={!canGo}
        style={{
          marginTop: 18,
          width: '100%',
          background: canGo ? C.accent : C.surface3,
          color: canGo ? C.onAccent : C.faint,
          fontSize: 15.5,
          fontWeight: 800,
          borderRadius: 26,
          padding: '16px 0',
          textAlign: 'center',
          cursor: canGo ? 'pointer' : 'default',
        }}
      >
        Comparer les stations sur le trajet
      </button>
    </div>
  );
}
