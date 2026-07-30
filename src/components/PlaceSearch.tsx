// Place search on the map tab. Picking a result MOVES THE SEARCH CIRCLE there
// (stations reload around it) — it does not start a route. Each suggestion
// also offers a secondary « Itinéraire › » shortcut that pre-fills the route
// setup for people who did want directions.
import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { m } from '../paraglide/messages.js';
import type { GeocodeResult } from '../data/types';
import { placeSublabel } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { useApp } from '../state/store';

export default function PlaceSearch() {
  const app = useApp();
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const runSearch = (text: string) => {
    clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const id = ++reqId.current;
    // The spinner covers the debounce too: from the typist's point of view the
    // search is already under way, and geocoders can take seconds to answer.
    setSearching(true);
    timer.current = setTimeout(() => {
      app
        // « Automatique » queries three geocoders: show each country's hits as
        // they land, and keep spinning until the last one has answered.
        .searchPlaces(text, {
          onPartial: (res) => {
            if (id === reqId.current) setSuggestions(res);
          },
        })
        .then((res) => {
          if (id !== reqId.current) return;
          setSuggestions(res);
          setSearching(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setSuggestions([]);
          setSearching(false);
        });
    }, 300);
  };

  const close = () => {
    clearTimeout(timer.current);
    reqId.current++;
    setOpen(false);
    setQuery('');
    setSuggestions([]);
    setSearching(false);
  };

  // Escape closes, like the filters popover — the ✕ must not be the only way
  // out. On the window: focus may sit on a suggestion, or on the map.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pickArea = (r: GeocodeResult) => {
    app.setSearchArea(r.point, r.label);
    close();
  };

  const pickRoute = (r: GeocodeResult) => {
    app.setTo(r.label, r.point);
    app.go('routeSetup');
    close();
  };

  // No padding of its own: the buttons inside carry it, so the whole box is
  // clickable and the focus ring wraps the box (`.search-box` in styles.css).
  const barStyle = {
    display: 'flex',
    alignItems: 'center',
    background: C.surface2,
    border: `1px solid ${C.border09}`,
    borderRadius: 28,
    boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    pointerEvents: 'auto' as const,
    width: '100%',
  };

  const pinIcon = (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: `2.5px solid ${C.mut}`,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -5,
          bottom: -4,
          width: 8,
          height: 2.5,
          background: C.mut,
          borderRadius: 2,
          transform: 'rotate(45deg)',
        }}
      />
    </div>
  );

  if (!open) {
    // Collapsed: current searched place (clearable in-bar) or the search prompt
    return (
      <div className="search-box" style={barStyle}>
        <button
          className="search-box-hit"
          onClick={() => setOpen(true)}
          aria-label={m.search_open_aria()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: 1,
            minWidth: 0,
            padding: app.searchLabel ? '14px 6px 14px 18px' : '14px 18px',
          }}
        >
          {pinIcon}
          <span
            style={{
              color: app.searchLabel ? C.ink : C.mut,
              fontSize: 15,
              fontWeight: app.searchLabel ? 600 : 400,
              flex: 1,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {app.searchLabel ?? m.search_prompt()}
          </span>
        </button>
        {app.searchLabel && (
          <button
            onClick={() => app.resetSearchToUser()}
            aria-label={m.search_reset_aria()}
            style={{
              flexShrink: 0,
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              color: C.mut,
              fontSize: 16,
              fontWeight: 700,
              padding: '0 16px 0 6px',
            }}
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {/* A click anywhere else closes, like the filters popover. Fixed so it
          covers the stage from inside the overlay slot; the panel after it is
          positioned, so it paints above. */}
      <button
        onClick={close}
        aria-label={m.search_close_overlay_aria()}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          cursor: 'default',
          pointerEvents: 'auto',
        }}
      />
      <div
        className="search-box"
        style={{
          position: 'relative',
          background: C.surface,
          border: `1px solid ${C.border09}`,
          borderRadius: 22,
          boxShadow: '0 14px 40px rgba(0,0,0,.55)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
          {pinIcon}
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={m.search_placeholder()}
            // A place is not a login: opt out of autofill overlays, which
            // cover the map and swallow Escape. 1Password ignores the
            // standard attribute and needs its own.
            autoComplete="off"
            data-1p-ignore=""
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              color: C.ink,
              fontSize: 15,
              fontFamily: 'Archivo, sans-serif',
              padding: 0,
            }}
          />
          {searching && (
            <span
              className="spin"
              role="status"
              aria-label={m.search_in_progress()}
              style={{ flexShrink: 0, color: C.accent, fontSize: 14, lineHeight: 1 }}
            >
              ↻
            </span>
          )}
          <button
            onClick={close}
            aria-label={m.search_close_aria()}
            style={{ color: C.mut, fontSize: 16, fontWeight: 700, padding: '0 2px' }}
          >
            ✕
          </button>
        </div>

        {suggestions.length > 0 && (
          // A dropdown OVER whatever sits under the bar — the phone's chips
          // and the map's floating controls — never part of the flow: opening
          // it must not push anything. On the phone it goes full-bleed: -17
          // undoes the overlay's 16px side insets (MapScreen) plus the bar's
          // own 1px border, since offsets count from the padding box.
          // Scrollable and capped to part of the viewport rather than
          // covering it; `overscroll-behavior: contain` keeps a flick at the
          // end of the list from reaching the map underneath.
          <div
            data-testid="search-suggestions"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: desktop ? -1 : -17,
              right: desktop ? -1 : -17,
              zIndex: 1,
              background: C.surface,
              border: `1px solid ${C.border09}`,
              borderRadius: desktop ? 18 : '0 0 18px 18px',
              boxShadow: '0 14px 40px rgba(0,0,0,.55)',
              maxHeight: 'min(46vh, 320px)',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {suggestions.map((r, i) => (
              <div
                key={`${r.label}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 16px' }}
              >
                <button
                  onClick={() => pickArea(r)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '8px 0', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>
                    {placeSublabel(r)} — {m.search_see_stations_here()}
                  </div>
                </button>
                <button
                  onClick={() => pickRoute(r)}
                  aria-label={m.search_route_to_aria({ place: r.label })}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.accent,
                    border: `1px solid ${C.accentBorder}`,
                    borderRadius: 14,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.search_route_shortcut()}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
