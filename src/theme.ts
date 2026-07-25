// Plein. design tokens — from the Claude Design prototype (« Cap nuit » dark system)

import type { CSSProperties } from 'react';
import { PANEL_GAP, PANEL_WIDTH } from './lib/layout';

export const C = {
  bg: '#101214', // app background
  surface: '#1a1d20', // cards
  surface2: '#1d2226', // chips / secondary surfaces
  surface3: '#22282c', // tertiary (avatars, bars)
  navBg: '#15181b',
  mapBg: '#14181a',
  accent: '#3ddc84', // green
  onAccent: '#08120c', // near-black on green
  ink: '#e8eaed', // primary text
  body: '#cfd6da', // secondary text on chips
  mut: '#8a949a', // muted text
  faint: '#5c666c', // faintest text
  ghost: '#3a4147', // footer text
  warn: '#e07a5f', // orange (expensive / destination / limits)
  border: 'rgba(255,255,255,.07)',
  border08: 'rgba(255,255,255,.08)',
  border09: 'rgba(255,255,255,.09)',
  border12: 'rgba(255,255,255,.12)',
  accentBorder: 'rgba(61,220,132,.25)',
  accentBorderStrong: 'rgba(61,220,132,.35)',
  accentSoft: 'rgba(61,220,132,.12)',
  accentSoft09: 'rgba(61,220,132,.09)',
  accentSoft10: 'rgba(61,220,132,.1)',
  accentSoft14: 'rgba(61,220,132,.14)',
  accentSoft15: 'rgba(61,220,132,.15)',
  toggleOff: '#2a3136',
} as const;

export const FONT = {
  mono: "'Spline Sans Mono', ui-monospace, monospace",
} as const;

/** Price in mono accent, e.g. font: mono(700, 22) */
export const mono = (weight: number, sizePx: number) =>
  `${weight} ${sizePx}px ${FONT.mono}`;

/**
 * « Glass » surface — the language of everything floating over the map on
 * desktop: the zone panel, the route timeline, the fiche, control clusters
 * and pills. The background stays near-opaque ON PURPOSE: a browser without
 * backdrop-filter simply skips the blur, and the content has to stay readable
 * over a busy map with nothing but this rgba behind it.
 */
export const glass: CSSProperties = {
  background: 'rgba(16,18,20,.86)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,.1)',
  boxShadow: '0 18px 50px rgba(0,0,0,.45)',
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
 * Primary CTA button — one single look across the app (onboarding, filtres,
 * itinéraire, fiche station). Spread it and override only what a screen really
 * needs (a shadow, a margin), so the type never drifts screen to screen.
 */
export const ctaStyle = (enabled = true): CSSProperties => ({
  width: '100%',
  background: enabled ? C.accent : C.surface3,
  color: enabled ? C.onAccent : C.faint,
  fontSize: 15.5,
  fontWeight: 800,
  borderRadius: 26,
  padding: '16px 0',
  textAlign: 'center',
  cursor: enabled ? 'pointer' : 'default',
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
  background: `linear-gradient(to top, ${C.bg} 62%, ${C.bg}00)`,
});
