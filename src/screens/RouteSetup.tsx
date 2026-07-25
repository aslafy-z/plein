import { useEffect, useRef, useState } from 'react';
import { C, ctaStyle, mono, stickyBarStyle } from '../theme';
import { type GeocodeResult } from '../data/types';
import { dayMonthLabel } from '../lib/format';
import { fuelLabel, placeSublabel } from '../lib/labels';
import { CONTENT_MAX_WIDTH, useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { useApp, routeFromLabel, type RecentPlace } from '../state/store';

type Field = 'from' | 'to';

export default function RouteSetup() {
  const app = useApp();
  const desktop = useIsDesktop();
  const { toText, fuel, tank } = app;

  const [focused, setFocused] = useState<Field | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqId = useRef(0);
  const toInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // « Où allez-vous ? » on the map focuses the destination (opens the keyboard)
  useEffect(() => {
    if (app.focusDestination) {
      toInputRef.current?.focus();
      app.consumeFocusDestination();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.focusDestination]);

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
    // Emptying the departure field means « wherever I am » again — the same
    // thing startRoute() does with a blank departure, made visible.
    if (field === 'from') {
      if (text.trim()) app.setFrom(text);
      else app.useCurrentPositionAsStart();
    } else app.setTo(text);
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

  /**
   * Sub label of a « Récents » row. Real trips carry their distance and date
   * as numbers, so the sentence is written in the language in force NOW;
   * the default suggestions carry a fixed place name instead.
   */
  const recentSublabel = (r: RecentPlace) =>
    r.distanceKm != null && r.at != null
      ? m.route_recent_trip({ km: Math.round(r.distanceKm), date: dayMonthLabel(r.at) })
      : (r.sublabel ?? '');

  // Capped and scrollable: a dozen suggestions would otherwise push the rest
  // of the form (and the CTA) far below the fold.
  const dropdown = (field: Field) =>
    focused === field && suggestions.length > 0 ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 8,
          maxHeight: 260,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
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
              // The list scrolls: rows keep their height instead of being
              // squeezed to fit the capped container.
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{r.label}</span>
            <span style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{placeSublabel(r)}</span>
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
        boxSizing: 'border-box',
        // A form, so a centered reading column rather than full bleed — two
        // address fields spread over 1400px are harder to fill, not easier
        maxWidth: CONTENT_MAX_WIDTH,
        width: '100%',
        margin: '0 auto',
        // Column layout so the CTA can be pushed to the bottom on a short form
        // (margin-top: auto) and stick there once the form scrolls
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: desktop ? '26px 32px 4px' : '16px 20px 4px' }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>{m.route_setup_title()}</div>
        <div style={{ fontSize: 13, color: C.mut, marginTop: 4 }}>{m.route_setup_subtitle()}</div>

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
              value={routeFromLabel(app)}
              placeholder={m.route_from_placeholder()}
              onFocus={() => setFocused('from')}
              onChange={(e) => onChange('from', e.target.value)}
              style={inputStyle}
            />
          </div>
          {dropdown('from')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: C.warn, flexShrink: 0 }} />
            <input
              ref={toInputRef}
              type="text"
              value={toText}
              placeholder={m.route_to_placeholder()}
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
            {app.hasTripHistory ? m.route_recents() : m.route_suggestions()}
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
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>
                    {recentSublabel(r)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Route preferences */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {(
            [
              [m.route_avoid_motorways(), app.avoidMotorway, app.setAvoidMotorway],
              [m.route_avoid_tolls(), app.avoidToll, app.setAvoidToll],
            ] as const
          ).map(([label, on, set]) => (
            <button
              key={label}
              onClick={() => set(!on)}
              style={{
                background: on ? C.accent : 'transparent',
                color: on ? C.onAccent : C.body,
                fontSize: 12.5,
                fontWeight: 700,
                padding: '8px 14px',
                borderRadius: 16,
                border: on ? `1px solid ${C.accent}` : '1px solid rgba(255,255,255,.15)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {on ? '✓ ' : ''}
              {label}
            </button>
          ))}
        </div>

        {/* Departure tank level — drives the autonomy line on the ribbon */}
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border08}`,
            borderRadius: 14,
            padding: '12px 16px',
            marginTop: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>
              {m.route_start_tank()}
            </span>
            <span style={{ font: mono(700, 14), color: C.accent }}>{app.startTankPct} %</span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={app.startTankPct}
            onChange={(e) => app.setStartTankPct(+e.target.value)}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
            {m.route_start_tank_hint()}
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
            <strong style={{ color: C.ink }}>{fuelLabel(fuel)}</strong> ·{' '}
            {m.route_settings_recap({ tank })}
          </div>
          <button
            onClick={() => app.go('settings')}
            style={{ fontSize: 12.5, fontWeight: 700, color: C.accent, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {m.route_settings_link()}
          </button>
        </div>
      </div>

      {/* CTA — sticky like the fiche station's « Y aller »: the primary action
          stays reachable while the form scrolls. The NavBar below already
          carries the safe-area inset, so this bar doesn't add its own. */}
      <div
        style={{
          ...stickyBarStyle(false),
          // Line the CTA up with the form's own gutter, which is wider here
          ...(desktop ? { padding: '14px 32px 26px' } : null),
        }}
      >
        <button onClick={() => app.startRoute()} disabled={!canGo} style={ctaStyle(canGo)}>
          {m.route_compare_cta()}
        </button>
      </div>
    </div>
  );
}
