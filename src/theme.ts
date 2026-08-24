// Plein. design tokens — from the Claude Design prototype (« Cap nuit » dark
// system), now with a light counterpart.
//
// The VALUES live in src/styles.css as CSS custom properties, one block per
// theme: `:root` carries the dark palette (the default), and
// `:root[data-theme='light']` overrides it. Flipping that single attribute
// (src/lib/colorScheme.ts) re-colors the whole app, because everything below
// is a var() reference — valid in React inline styles and in the divIcon HTML
// strings the maps build. The one place a var() cannot reach is an SVG
// presentation attribute Leaflet writes on its vector layers; those get a
// className instead, styled from styles.css (`.zone-circle`, `.route-line`).
//
// Adding a token: add its var() name here, then its dark AND light values in
// styles.css — a token missing from one block silently falls through to the
// other theme's look.

import type { CSSProperties } from 'react';
import { LITE_FX } from './lib/fx';
import { PANEL_GAP, PANEL_WIDTH } from './lib/layout';

export const C = {
  bg: 'var(--c-bg)', // app background
  surface: 'var(--c-surface)', // cards
  surface2: 'var(--c-surface-2)', // chips / secondary surfaces
  surface3: 'var(--c-surface-3)', // tertiary (avatars, bars)
  card: 'var(--c-card)', // bordered list cards (zone rows, timeline stops) —
  // surface2's dark value, but paper-white in light where a grey tile reads
  // as disabled rather than as a card

  navBg: 'var(--c-nav-bg)',
  mapBg: 'var(--c-map-bg)',
  accent: 'var(--c-accent)', // green
  onAccent: 'var(--c-on-accent)', // text on the accent green
  ink: 'var(--c-ink)', // primary text
  body: 'var(--c-body)', // secondary text on chips
  body2: 'var(--c-body-2)', // between body and mut (fiche secondary lines)
  mut: 'var(--c-mut)', // muted text
  faint: 'var(--c-faint)', // faintest text
  ghost: 'var(--c-ghost)', // footer text
  warn: 'var(--c-warn)', // orange (expensive / destination / limits)
  border: 'var(--c-border)',
  border08: 'var(--c-border-08)',
  border09: 'var(--c-border-09)',
  border12: 'var(--c-border-12)',
  border15: 'var(--c-border-15)',
  border18: 'var(--c-border-18)', // sheet drag handles
  border20: 'var(--c-border-20)',
  border25: 'var(--c-border-25)', // radio / checkbox rings
  divider: 'var(--c-divider)', // hairline between list rows
  accentBorder: 'var(--c-accent-border)',
  accentBorderStrong: 'var(--c-accent-border-strong)',
  accentBorder30: 'var(--c-accent-border-30)',
  accentBorder40: 'var(--c-accent-border-40)',
  accentSoft: 'var(--c-accent-soft)',
  accentSoft05: 'var(--c-accent-soft-05)',
  accentSoft09: 'var(--c-accent-soft-09)',
  accentSoft10: 'var(--c-accent-soft-10)',
  accentSoft14: 'var(--c-accent-soft-14)',
  accentSoft15: 'var(--c-accent-soft-15)',
  accentPale: 'var(--c-accent-pale)', // ring of a focused deal pin
  accentDeep: 'var(--c-accent-deep)', // ring around the geolocation dot
  accentGlow25: 'var(--c-accent-glow-25)', // accent-tinted shadows
  accentGlow28: 'var(--c-accent-glow-28)',
  accentGlow35: 'var(--c-accent-glow-35)',
  accentGlow55: 'var(--c-accent-glow-55)',
  warnSoft: 'var(--c-warn-soft)',
  warnSoft14: 'var(--c-warn-soft-14)',
  warnBorder30: 'var(--c-warn-border-30)',
  warnBorder35: 'var(--c-warn-border-35)',
  warnDeep: 'var(--c-warn-deep)', // ring around the destination dot
  warnText: 'var(--c-warn-text)', // body text on a warnSoft banner
  toggleOff: 'var(--c-toggle-off)',
  overlay: 'var(--c-overlay)', // bg at ~85% — rows over the fiche mini-map
  scrim: 'var(--c-scrim)', // dialog backdrop
  scrimSoft: 'var(--c-scrim-soft)', // map dimmed under a sheet
  glassBg: 'var(--c-glass-bg)',
  glassBgSoft: 'var(--c-glass-bg-soft)', // map control pills
  glassBgStrong: 'var(--c-glass-bg-strong)', // anchored popovers
  glassBorder: 'var(--c-glass-border)',
  glassEdge: 'var(--c-glass-edge)', // 1px inner top light on glass surfaces
  // Shadow COLORS (the geometry stays at the call site) — softer in light
  shadow35: 'var(--c-shadow-35)',
  shadow40: 'var(--c-shadow-40)',
  shadow45: 'var(--c-shadow-45)',
  shadow50: 'var(--c-shadow-50)',
  shadow55: 'var(--c-shadow-55)',
} as const;

export const FONT = {
  mono: "'Spline Sans Mono', ui-monospace, monospace",
} as const;

/** Price in mono accent, e.g. font: mono(700, 22) */
export const mono = (weight: number, sizePx: number) =>
  `${weight} ${sizePx}px ${FONT.mono}`;

/**
 * Display type — every screen-level title (Settings, Favorites, the route
 * setup, the trip header, a fiche's name). Archivo at display sizes must be
 * set tighter than the body or it reads as inflated body text — the
 * onboarding headline learned this first, and the other titles had not
 * followed. One helper, so the tracking and leading cannot drift per screen.
 */
export const display = (sizePx: number, weight = 800): CSSProperties => ({
  fontSize: sizePx,
  fontWeight: weight,
  letterSpacing: sizePx >= 28 ? '-.025em' : '-.02em',
  lineHeight: sizePx >= 28 ? 1.1 : 1.15,
  color: C.ink,
});

/**
 * The uppercase kicker — the small label that opens a section or crowns a
 * card (« Cheapest nearby », « Your route », the Settings section labels).
 * The tracking had wandered .08–.14em per screen before it was pulled here;
 * callers spread it and override only placement (margins, flex) and color.
 */
export const kicker = (color: string = C.mut): CSSProperties => ({
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color,
});

/**
 * Compact accent pill — ctaStyle's smaller relatives (the zone card's « Go
 * there », the empty states' way out, a timeline stop's CTA). One skin —
 * accent fill, 800 weight, one radius, the CTA's glow — where four sites had
 * grown four geometries. Callers keep only their type size and placement.
 */
export const accentPill = (fontSizePx: number, padding: string): CSSProperties => ({
  background: C.accent,
  color: C.onAccent,
  fontSize: fontSizePx,
  fontWeight: 800,
  letterSpacing: '.01em',
  borderRadius: 22,
  padding,
  textAlign: 'center',
  cursor: 'pointer',
  boxShadow: `0 8px 20px ${C.accentGlow25}`,
  // transform is listed for the same reason as in ctaStyle: an inline
  // transition REPLACES the .press class's own, and without it the compress
  // would snap instead of ease
  transition:
    'transform 0.16s var(--ease-snap), box-shadow 0.25s var(--ease-snap), filter 0.2s var(--ease-snap)',
});

/**
 * Sort chip — the « Recommended · Price · Distance » toggle above the zone
 * list and the favorites grid: the same control wore two geometries. Kept at
 * the zone list's compact size on purpose — its count/sort row must hold ONE
 * line at the panel floor (see ZoneList).
 */
export const sortChipStyle = (active: boolean): CSSProperties => ({
  fontSize: 12,
  fontWeight: 700,
  color: active ? C.onAccent : C.mut,
  background: active ? C.accent : C.surface2,
  padding: '5px 11px',
  borderRadius: 14,
  whiteSpace: 'nowrap',
  // transform rides along for .press — same note as accentPill
  transition:
    'background .25s var(--ease-snap), color .25s var(--ease-snap), transform .16s var(--ease-snap)',
});

/**
 * Backdrop blur, everywhere a glass surface asks for one — skipped wholesale
 * in lite-effects mode (Gecko, see lib/fx.ts): re-blurring the backdrop on
 * every frame a Leaflet animation dirties it is one of the two effects that
 * made opening the panels stutter on Firefox.
 */
export const glassBlur = (radiusPx: number): CSSProperties =>
  LITE_FX
    ? {}
    : {
        backdropFilter: `blur(${radiusPx}px)`,
        WebkitBackdropFilter: `blur(${radiusPx}px)`,
      };

/**
 * « Glass » surface — the language of everything floating over the map on
 * desktop: the zone panel, the route timeline, the fiche, control clusters
 * and pills. The background stays near-opaque ON PURPOSE: a browser without
 * backdrop-filter — and lite-effects mode, where `glassBlur` yields none —
 * simply skips the blur, and the content has to stay readable over a busy
 * map with nothing but this rgba behind it.
 */
export const glass: CSSProperties = {
  background: C.glassBg,
  ...glassBlur(16),
  border: `1px solid ${C.glassBorder}`,
  // Three layers, one material: the inset top light is what makes the pane
  // read as GLASS (an edge catching the light) rather than a tinted
  // rectangle; the long throw seats it over the map and the short one keeps
  // its edge crisp where the long throw is too diffuse to hold it.
  boxShadow: `inset 0 1px 0 ${C.glassEdge}, 0 18px 50px ${C.shadow45}, 0 2px 10px ${C.shadow35}`,
};

/**
 * The floating panel slot: left edge of the map stage, full height, panel
 * width. MapScreen puts the zone list or the fiche in it, RouteRibbon its
 * timeline — one geometry, so the two screens can never drift apart. The
 * children fill it (transparent background, their own scroll).
 */
export const floatingPanelStyle: CSSProperties = {
  position: 'absolute',
  left: PANEL_GAP,
  top: PANEL_GAP,
  bottom: PANEL_GAP,
  width: PANEL_WIDTH,
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderRadius: 18,
  overflow: 'hidden',
  ...glass,
};

/**
 * Primary CTA button — one single look across the app (onboarding, filters,
 * route, station fiche). Spread it and override only what a screen really
 * needs (a shadow, a margin), so the type never drifts screen to screen.
 */
export const ctaStyle = (enabled = true): CSSProperties => ({
  width: '100%',
  background: enabled ? C.accent : C.surface3,
  color: enabled ? C.onAccent : C.faint,
  fontSize: 15.5,
  fontWeight: 800,
  letterSpacing: '.01em',
  borderRadius: 26,
  padding: '16px 0',
  textAlign: 'center',
  cursor: enabled ? 'pointer' : 'default',
  // The one control allowed to glow: an accent-tinted throw seats the CTA
  // above the page the way the panels sit above the map. Callers add
  // className="press" for the compress-on-press half of the physics.
  boxShadow: enabled ? `0 10px 26px ${C.accentGlow25}` : 'none',
  // transform is listed here because an inline transition REPLACES the
  // .press class's own — without it the compress would snap instead of ease
  transition:
    'transform 0.16s var(--ease-snap), box-shadow 0.25s var(--ease-snap), filter 0.2s var(--ease-snap)',
});

/**
 * Bar holding a sticky CTA at the bottom of a scrolling screen: it stays
 * reachable on a long page and sits on the bottom edge on a short one
 * (margin-top: auto). The gradient keeps content readable as it passes under.
 */
export const stickyBarStyle = (safeArea = true): CSSProperties => ({
  position: 'sticky',
  bottom: 0,
  marginTop: 'auto',
  padding: safeArea
    ? '14px 20px calc(18px + env(safe-area-inset-bottom, 0px))'
    : '14px 20px 16px',
  // --c-bg-0 is the same color fully transparent — `transparent` would be
  // interpolated from black in browsers that don't premultiply
  background: 'linear-gradient(to top, var(--c-bg) 62%, var(--c-bg-0))',
});
