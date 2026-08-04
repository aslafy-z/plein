// THE place search field — one implementation for the map's search and the
// route's departure and arrival fields, so the behaviour can never drift
// between them again. It owns the debounce and its request guard, the
// `onPartial` streaming, the spinner, the ✕, the `.search-box` focus ring,
// the autofill opt-outs, Escape and outside-click close, Enter taking the
// top-ranked row, the shared history rows (« Recent », ↺, ranked above the
// geocoder — src/state/searchHistory.ts) — and BOTH containers:
//
// - on a window, a dropdown attached under the field, floating over whatever
//   sits below (it pushes nothing);
// - on a phone, the whole screen: portalled out of the map overlay's stacking
//   context and sized on the VISIBLE viewport, because the keyboard does not
//   shrink the layout viewport and a `inset: 0` overlay would run its last
//   rows behind the keys.
//
// What stays with each caller is policy: what picking a place does, what the
// collapsed state looks like (the map's pill), the extra row action
// (« Directions › ») and the wording of the empty state.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../theme';
import { m } from '../paraglide/messages.js';
import type { GeocodeResult } from '../data/types';
import { placeSublabel } from '../lib/labels';
import { useIsDesktop, useVisualViewport } from '../lib/layout';
import { useApp, type SearchTarget } from '../state/store';
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

export interface PlaceFieldRowAction {
  label: string;
  aria(place: string): string;
  pick(r: GeocodeResult): void;
}

export interface PlaceFieldProps {
  /** Which field this is — the phone's full-screen search opens when
      `app.searchOpen` names it, so the system Back closes the right one */
  target: SearchTarget;
  /** Committed value the field shows while not being edited */
  value: string;
  placeholder: string;
  /** Phone panel header naming the field being filled (« Departure »…) */
  title?: string;
  /** Leading glyph inside the box (the map's pin, the route's dot/square) */
  icon?: ReactNode;
  /** Live text edits write through — the CTA may geocode unpicked text */
  onChangeText?(text: string): void;
  /** Text the input holds when editing begins (defaults to `value`) — the
      departure field edits as empty while it means « My position » */
  editValue?: string;
  /** Picking a row. The field remembers the place and closes itself first. */
  onPick(r: GeocodeResult): void;
  /** The pick itself navigates (the destination pick starts the compute and
      `go()` stacks the route screen on top): the field must NOT pop the
      search's history entry — the pending `history.back()` would land AFTER
      the navigation and clobber it. `go()` closes the search plainly, and
      Back returns into it — the « Directions › » row's idiom. */
  pickNavigates?: boolean;
  /** Map only — the whole field is nav-open state: ✕, Escape and a click
      outside close it (the route fields are always on screen instead) */
  onClose?(): void;
  /** ✕ on a non-empty committed value (route fields: back to empty / « My
      position ») — the map's open field gets the close ✕ via onClose */
  onClear?(): void;
  clearAria?: string;
  autoFocus?: boolean;
  /** Extra action button per row (the map's « Directions › ») */
  rowAction?: PlaceFieldRowAction;
  /** Appended to each row's sublabel (map: « see the stations here ») */
  rowHint?: string;
  /** What an empty query should say under the phone's field */
  emptyHint: string;
}

export default function PlaceField(props: PlaceFieldProps) {
  const app = useApp();
  const desktop = useIsDesktop();
  const viewport = useVisualViewport();
  const open = app.searchOpen === props.target;

  // ── The one debounce + request guard of the app ────────────────────────────
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

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
        // « Automatic » queries several geocoders: show each country's hits
        // as they land, and keep spinning until the last one has answered.
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

  /** Drop the pending search: nothing in flight may land after this. */
  const cancelSearch = () => {
    clearTimeout(timer.current);
    reqId.current++;
    setSuggestions([]);
    setSearching(false);
  };

  // Desktop editing state — the dropdown only exists under a focused field.
  // The map's field is only mounted while open, so it is born editing.
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // The phone panel's own input text (opens fresh on each open)
  const [panelText, setPanelText] = useState('');

  const beginEditing = () => {
    if (editing) return;
    setEditing(true);
    setText(props.editValue ?? props.value);
  };
  const endEditing = () => {
    setEditing(false);
    cancelSearch();
  };

  // Opening the phone panel focuses its field; closing clears it and drops
  // the answers still in flight — whichever of the ←, Back, a picked place
  // or a screen change did the closing.
  useEffect(() => {
    if (desktop) return;
    if (open) {
      setPanelText(props.editValue ?? '');
      inputRef.current?.focus();
      return;
    }
    setPanelText('');
    cancelSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, desktop]);

  // Escape closes — the whole field when it is nav-open state (the map), the
  // suggestions when the field always stays on screen (the route).
  const active = desktop ? editing || props.onClose != null : open;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (props.onClose) props.onClose();
      else {
        endEditing();
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const queryText = desktop ? (editing ? text : props.value) : panelText;
  const rows = searchRows(app.searchHistory, suggestions, queryText);
  const historyCount = rows.filter((row) => row.fromHistory).length;

  // Both the pick and the row action feed the one place history: what matters
  // is that the place was looked up, not what was done with it.
  const pick = (r: GeocodeResult) => {
    app.rememberSearchedPlace(r);
    cancelSearch();
    if (props.pickNavigates) {
      // The caller's onPick navigates via go(), which closes the search
      // without popping its entry — popping here would race that push
      if (desktop) {
        setEditing(false);
        inputRef.current?.blur();
      }
    } else if (props.onClose) {
      // The whole field is nav-open state (the map): picking closes it
      props.onClose();
    } else if (desktop) {
      setEditing(false);
      inputRef.current?.blur();
    } else if (open) {
      app.setSearchOpen(null);
    }
    props.onPick(r);
  };
  const rowActionPick = (r: GeocodeResult) => {
    app.rememberSearchedPlace(r);
    props.rowAction?.pick(r);
  };

  const onInput = (nextText: string, phone: boolean) => {
    if (phone) setPanelText(nextText);
    else setText(nextText);
    props.onChangeText?.(nextText);
    runSearch(nextText);
  };

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

  const spinner = searching && (
    <span
      className="spin"
      role="status"
      aria-label={m.search_in_progress()}
      style={{ flexShrink: 0, color: C.accent, fontSize: 14, lineHeight: 1 }}
    >
      ↻
    </span>
  );

  const field = (phone: boolean) => (
    <>
      {props.icon}
      <input
        ref={inputRef}
        type="text"
        value={phone ? panelText : editing ? text : props.value}
        placeholder={props.placeholder}
        // A place is not a login: opt out of autofill overlays, which
        // cover the map and swallow Escape. 1Password ignores the
        // standard attribute and needs its own.
        autoComplete="off"
        data-1p-ignore=""
        // A phone keyboard offers « search » rather than a line break,
        // and a town name is not a sentence to correct.
        enterKeyHint="search"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={!phone && props.autoFocus}
        onFocus={phone ? undefined : beginEditing}
        onBlur={(e) => {
          if (phone || props.onClose) return;
          // Focus moving WITHIN the box (its own ✕) is not leaving the field
          const box = e.currentTarget.closest('.search-box');
          if (box && e.relatedTarget instanceof Node && box.contains(e.relatedTarget)) return;
          // No dropdown up → nothing left to dismiss: let the field settle.
          // With rows on screen the blur is a row click or the overlay —
          // both handle the close themselves, and unmounting the dropdown
          // here would kill the click before it lands.
          if (rows.length === 0) endEditing();
        }}
        onChange={(e) => onInput(e.target.value, phone)}
        // The keyboard's search key takes the first row — the one the ranking
        // already put on top — instead of doing nothing at all.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || rows.length === 0) return;
          e.preventDefault();
          pick(rows[0].place);
        }}
        style={inputStyle}
      />
      {spinner}
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
            onClick={() => pick(r)}
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
              {placeSublabel(r)}
              {props.rowHint ? ` — ${props.rowHint}` : ''}
            </div>
          </button>
          {props.rowAction && (
            <button
              onClick={() => rowActionPick(r)}
              aria-label={props.rowAction.aria(r.label)}
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
              {props.rowAction.label}
            </button>
          )}
        </div>
      ))}
    </>
  );

  // ── Phone: a trigger box on the stage, the whole screen once open ──────────
  if (!desktop) {
    // The map's collapsed pill is the caller's own — no trigger to render
    const trigger = props.onClose ? null : (
      <div
        className="search-box"
        style={{
          display: 'flex',
          alignItems: 'center',
          background: C.surface,
          border: `1px solid ${C.border09}`,
          borderRadius: 22,
          boxShadow: `0 8px 24px ${C.shadow40}`,
          pointerEvents: 'auto',
        }}
      >
        <button
          className="search-box-hit"
          onClick={() => app.setSearchOpen(props.target)}
          aria-label={props.title ?? props.placeholder}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: 1,
            minWidth: 0,
            padding: '13px 6px 13px 16px',
          }}
        >
          {props.icon}
          <span
            style={{
              color: props.value ? C.ink : C.mut,
              fontSize: 15,
              fontWeight: props.value ? 600 : 400,
              flex: 1,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {props.value || props.placeholder}
          </span>
        </button>
        {props.value !== '' && props.onClear ? (
          <button
            onClick={props.onClear}
            aria-label={props.clearAria ?? m.search_clear_aria()}
            style={{
              flexShrink: 0,
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              color: C.mut,
              fontSize: 16,
              fontWeight: 700,
              padding: '0 14px 0 6px',
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
    );

    // The search IS the screen. The map behind a keyboard is unusable, so
    // nothing is left of it — the field rides the top and the results own
    // everything down to the keys. Sized on the VISIBLE viewport rather than
    // `inset: 0` (see useVisualViewport), portalled out of the map overlay's
    // stacking context (see overlayHost).
    const panel = open
      ? createPortal(
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
            {props.title && (
              // Names the field being filled — with three search fields in
              // the app, a bare input no longer says which one this is.
              <div
                style={{
                  padding: 'calc(12px + env(safe-area-inset-top, 0px)) 20px 0',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: C.mut,
                }}
              >
                {props.title}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: props.title
                  ? '8px 12px 10px'
                  : 'calc(10px + env(safe-area-inset-top, 0px)) 12px 10px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <button
                onClick={() => app.setSearchOpen(null)}
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
                {field(true)}
                {panelText !== '' && (
                  <button
                    onClick={() => {
                      onInput('', true);
                      inputRef.current?.focus();
                    }}
                    aria-label={m.search_clear_aria()}
                    style={{
                      flexShrink: 0,
                      color: C.mut,
                      fontSize: 15,
                      fontWeight: 700,
                      padding: '0 2px',
                    }}
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
                  : panelText.trim().length >= MIN_QUERY
                    ? m.search_no_results()
                    : props.emptyHint}
              </div>
            )}
          </div>,
          overlayHost(),
        )
      : null;

    return (
      <>
        {trigger}
        {panel}
      </>
    );
  }

  // ── Window: the box, and a dropdown attached under it ──────────────────────
  const showRows = rows.length > 0 && (props.onClose != null || editing);
  const clearable = editing ? text !== '' : props.value !== '' && props.onClear != null;

  return (
    <>
      {/* A click anywhere else closes, like the filters popover. Fixed so it
          covers the stage from inside the overlay slot; the box after it is
          positioned, so it paints above. Only while there is something to
          dismiss — a focused route field without a dropdown must not eat the
          first click on the CTA. */}
      {(props.onClose != null || showRows) && (
        <button
          onClick={() => {
            if (props.onClose) props.onClose();
            else {
              endEditing();
              inputRef.current?.blur();
            }
          }}
          aria-label={m.search_close_overlay_aria()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'transparent',
            cursor: 'default',
            pointerEvents: 'auto',
          }}
        />
      )}
      <div
        className="search-box"
        style={{
          position: 'relative',
          // An open dropdown must paint over the sibling field under it (the
          // route stacks two of these boxes)
          zIndex: showRows ? 2 : undefined,
          background: C.surface,
          border: `1px solid ${C.border09}`,
          // The attached list squares the bar's bottom so the two read as one
          borderRadius: showRows ? '22px 22px 0 0' : 22,
          boxShadow: `0 14px 40px ${C.shadow55}`,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
          {field(false)}
          {props.onClose ? (
            <button
              onClick={props.onClose}
              aria-label={m.search_close_aria()}
              style={{ color: C.mut, fontSize: 16, fontWeight: 700, padding: '0 2px' }}
            >
              ✕
            </button>
          ) : clearable ? (
            <button
              onClick={() => {
                // Focus FIRST: its own beginEditing state updates must land
                // before the explicit ones below, or a blur/focus race puts
                // the committed text back under the cursor being cleared.
                inputRef.current?.focus();
                setEditing(true);
                setText('');
                props.onChangeText?.('');
                props.onClear?.();
                cancelSearch();
              }}
              aria-label={props.clearAria ?? m.search_clear_aria()}
              style={{ color: C.mut, fontSize: 16, fontWeight: 700, padding: '0 2px' }}
            >
              ✕
            </button>
          ) : null}
        </div>

        {showRows && (
          // A dropdown OVER whatever sits under the box — never part of the
          // flow: opening it must not push anything, the form and the CTA
          // included. It sits flush under the box so the two read as ONE box
          // with a divider. Scrollable and capped to part of the viewport;
          // `overscroll-behavior: contain` keeps a flick at the end of the
          // list from reaching the map underneath.
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
              boxShadow: `0 14px 40px ${C.shadow55}`,
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
