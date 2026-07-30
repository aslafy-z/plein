// Place search on the map tab. Picking a result MOVES THE SEARCH CIRCLE there
// (stations reload around it) — it does not start a route. Each suggestion
// also offers a secondary « Itinéraire › » shortcut that pre-fills the route
// setup for people who did want directions.
//
// A picked place is remembered: opening the search offers the history straight
// away, and typing ranks the matching entries above the geocoder's answers
// (src/state/searchHistory.ts).
//
// Two arrangements, one behaviour: a window gets a dropdown attached under the
// bar, a phone gets the whole screen. A dropdown floating over the map is the
// wrong shape once a keyboard eats half the phone — the map behind it is
// unusable anyway, and what is left shows one result and a half.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../theme';
import { m } from '../paraglide/messages.js';
import type { GeocodeResult } from '../data/types';
import { placeSublabel } from '../lib/labels';
import { useIsDesktop, useVisualViewport } from '../lib/layout';
import { useApp } from '../state/store';
import { searchRows } from '../state/searchHistory';

/** Shorter than this and no geocoder is called — « to » matches a country */
const MIN_QUERY = 3;

/**
 * Where the phone's full-screen search mounts. Not `document.body`: the hover
 * and focus-ring rules of styles.css are scoped to `.app-shell`, and a panel
 * outside it would lose them. Anywhere in the shell is enough to escape the
 * map overlay's stacking context, which is the point of portalling at all.
 * The node is the same object on every render, so React keeps the subtree —
 * a new container would remount it, and the field would lose focus on every
 * keystroke.
 */
function overlayHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.app-shell') ?? document.body;
}

export default function PlaceSearch() {
  const app = useApp();
  const desktop = useIsDesktop();
  const viewport = useVisualViewport();
  // Open/closed is NAV state, not the panel's own: on a phone the search is a
  // screen, and the system Back has to close it rather than leave the map.
  // What was typed stays here — a popped entry has no query to restore.
  const open = app.searchOpen;
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Opening focuses the field; closing clears it and drops the answers still
  // in flight — whichever of the ✕, Escape, a picked place, Back or a screen
  // change did the closing.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    clearTimeout(timer.current);
    reqId.current++;
    setQuery('');
    setSuggestions([]);
    setSearching(false);
  }, [open]);

  const runSearch = (text: string) => {
    clearTimeout(timer.current);
    if (text.trim().length < MIN_QUERY) {
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

  const close = () => app.setSearchOpen(false);

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

  // Both shortcuts are a place the user looked up, so both feed the history:
  // what matters is that the place was searched, not what was done with it.
  const pickArea = (r: GeocodeResult) => {
    app.rememberSearchedPlace(r);
    app.setSearchArea(r.point, r.label);
    close();
  };

  // No close() here: `go` leaves the search behind on its own history entry,
  // so Back out of the route setup returns to the search it was started from.
  const pickRoute = (r: GeocodeResult) => {
    app.rememberSearchedPlace(r);
    app.setTo(r.label, r.point);
    app.go('routeSetup');
  };

  const rows = useMemo(
    () => searchRows(app.searchHistory, suggestions, query),
    [app.searchHistory, suggestions, query],
  );
  const historyCount = rows.filter((row) => row.fromHistory).length;

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
          onClick={() => app.setSearchOpen(true)}
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

  // The field — one markup for both arrangements, so the placeholder, the
  // spinner and the autofill opt-outs can never drift apart.
  const field = (
    <>
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
        // A phone keyboard offers « rechercher » rather than a line break,
        // and a town name is not a sentence to correct.
        enterKeyHint="search"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          runSearch(e.target.value);
        }}
        // The keyboard's search key takes the first row — the one the ranking
        // already put on top — instead of doing nothing at all.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || rows.length === 0) return;
          e.preventDefault();
          pickArea(rows[0].place);
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
    </>
  );

  // The rows, and the title over the remembered ones. Shared: only the
  // paddings and the row separators belong to an arrangement — a phone list
  // runs full-bleed and needs lines to stay scannable, a dropdown is a small
  // box where the same lines would only add noise.
  const listContent = (phone: boolean) => (
    <>
      {historyCount > 0 && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: C.mut,
            padding: '10px 16px 2px',
          }}
        >
          {m.search_recents_title()}
        </div>
      )}
      {rows.map(({ place: r, fromHistory }, i) => (
        <div
          key={`${r.label}-${i}`}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: phone ? '2px 12px 2px 18px' : '4px 8px 4px 16px',
            // Where the remembered places end and the geocoder's own
            // answers start — the two blocks must not read as one list.
            ...(i === historyCount && historyCount > 0
              ? { borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 8 }
              : phone && i > 0
                ? { borderTop: `1px solid ${C.border08}` }
                : null),
          }}
        >
          {/* Marks a remembered place. It sits in the row's own left
              gutter rather than in a column of its own: a marked row and
              a geocoder hit keep the same width, and their labels stay
              on the same line whether or not anything is remembered. */}
          {fromHistory && (
            <span
              role="img"
              aria-label={m.search_recent_place_aria()}
              style={{
                position: 'absolute',
                left: phone ? 6 : 5,
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.mut,
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              ↺
            </span>
          )}
          <button
            onClick={() => pickArea(r)}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
              padding: phone ? '12px 0' : '8px 0',
              cursor: 'pointer',
            }}
          >
            {/* Both lines stay on ONE line each: a wrapped address turns a
                list of places into a wall of text, and rows of different
                heights are what makes it unscannable. */}
            <div
              style={{
                fontSize: phone ? 15 : 14.5,
                fontWeight: 600,
                color: C.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.label}
            </div>
            <div
              style={{
                fontSize: 12,
                color: C.faint,
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
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
              padding: phone ? '8px 12px' : '6px 10px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {m.search_route_shortcut()}
          </button>
        </div>
      ))}
    </>
  );

  if (!desktop) {
    // Phone: the search IS the screen. The map behind a keyboard is unusable,
    // so nothing is left of it — the field rides the top and the results own
    // everything down to the keys.
    //
    // Sized on the VISIBLE viewport rather than on `inset: 0`: the keyboard
    // does not shrink the layout viewport, so a fixed overlay would run its
    // last rows behind the keys (see `useVisualViewport`).
    //
    // Portalled out: the bar rides a map overlay whose own z-index opens a
    // stacking context, and no number inside it can climb over the bottom
    // sheet floating beside it.
    return createPortal(
      <div
        className="sheet-swap"
        data-testid="search-panel"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          top: viewport.offsetTop,
          height: viewport.height || '100dvh',
          zIndex: 1200,
          background: C.bg,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 'calc(10px + env(safe-area-inset-top, 0px)) 12px 10px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <button
            onClick={close}
            aria-label={m.search_close_aria()}
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.ink,
              fontSize: 18,
            }}
          >
            ←
          </button>
          <div
            className="search-box"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: C.surface2,
              border: `1px solid ${C.border09}`,
              borderRadius: 22,
              padding: '11px 14px',
            }}
          >
            {field}
            {query !== '' && (
              <button
                onClick={() => {
                  setQuery('');
                  runSearch('');
                  inputRef.current?.focus();
                }}
                aria-label={m.search_clear_aria()}
                style={{ flexShrink: 0, color: C.mut, fontSize: 15, fontWeight: 700, padding: '0 2px' }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {rows.length > 0 ? (
          <div
            data-testid="search-suggestions"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            {listContent(true)}
          </div>
        ) : (
          // Never a blank screen: what to type, or that nothing was found.
          // The spinner in the field already speaks for a search under way.
          <div
            style={{
              flex: 1,
              padding: '28px 28px 0',
              textAlign: 'center',
              color: C.mut,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {searching
              ? null
              : query.trim().length >= MIN_QUERY
                ? m.search_no_results()
                : m.search_hint()}
          </div>
        )}
      </div>,
      overlayHost(),
    );
  }

  return (
    <>
      {/* A click anywhere else closes, like the filters popover. Fixed so it
          covers the stage from inside the overlay slot; the panel after it is
          positioned, so it paints above. The phone has no use for it: its
          search covers the screen, and the ← is the way back. */}
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
          // The attached list squares the bar's bottom so the two read as one
          borderRadius: rows.length > 0 ? '22px 22px 0 0' : 22,
          boxShadow: '0 14px 40px rgba(0,0,0,.55)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
          {field}
          <button
            onClick={close}
            aria-label={m.search_close_aria()}
            style={{ color: C.mut, fontSize: 16, fontWeight: 700, padding: '0 2px' }}
          >
            ✕
          </button>
        </div>

        {rows.length > 0 && (
          // A dropdown OVER whatever sits under the bar — the map's floating
          // controls — never part of the flow: opening it must not push
          // anything. It sits flush under the bar so the two read as ONE box
          // with a divider. Scrollable and capped to part of the viewport
          // rather than covering it; `overscroll-behavior: contain` keeps a
          // flick at the end of the list from reaching the map underneath.
          <div
            data-testid="search-suggestions"
            style={{
              position: 'absolute',
              top: '100%',
              left: -1,
              right: -1,
              zIndex: 1,
              background: C.surface,
              border: `1px solid ${C.border09}`,
              borderTop: `1px solid ${C.border}`,
              borderRadius: '0 0 22px 22px',
              boxShadow: '0 14px 40px rgba(0,0,0,.55)',
              maxHeight: 'min(46vh, 320px)',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {listContent(false)}
          </div>
        )}
      </div>
    </>
  );
}
