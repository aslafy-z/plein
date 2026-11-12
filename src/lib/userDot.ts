// The « you are here » dot both maps drop on the user's position — the zone
// map (MapCanvas) and the route map (RouteMap) — and the onboarding shows
// beside its location row, as a preview of it. One markup builder for the
// same reason lib/pricePin has one: the two maps read as a single map across
// tabs, and a dot that drifted in size or color between them would read as
// two different things. Pure string builder: the callers wrap the HTML in an
// L.divIcon, and the tests read the markup directly.
//
// Colors are C tokens — var() references that resolve in the divIcon's inline
// styles, so the dot re-tints with the theme.

import { C } from '../theme';

/** Side of the icon box, soft halo included — the callers' iconSize/iconAnchor */
export const USER_DOT_SIZE = 34;

/**
 * Class both callers put on the divIcon. It styles nothing — it is the e2e's
 * handle on « is the user drawn at all », which a Leaflet layer offers no role
 * or test id for, and the answer has to be assertable: the dot is only ever
 * drawn on a position geolocation returned (`hasKnownPos`), never on the
 * default area the app falls back to.
 */
export const USER_DOT_CLASS = 'user-dot';

/**
 * The shape itself: a ringed dot that glows, inside a halo that keeps
 * radiating outward (`.halo-pulse` in styles.css, frozen under reduced
 * motion), centered in its box. The user dot is its accent tone; the
 * searched-place dot (lib/placePin) is the same shape in neutral ink — a
 * variant, so the two read as one family of « a point on the map » while the
 * accent stays reserved for the user. Both have to be found at a glance on a
 * busy basemap, under a field of price bubbles: hence the glow and the wave
 * rather than a flat disc.
 */
export function haloDotHtml(tone: {
  halo: string;
  fill: string;
  ring: string;
  glow: string;
}): string {
  return (
    `<div style="position:relative;width:${USER_DOT_SIZE}px;height:${USER_DOT_SIZE}px;` +
    `border-radius:50%;background:${tone.halo};display:flex;align-items:center;` +
    `justify-content:center">` +
    `<div class="halo-pulse" style="background:${tone.halo}"></div>` +
    `<div style="position:relative;width:16px;height:16px;border-radius:50%;` +
    `background:${tone.fill};border:3px solid ${tone.ring};box-sizing:border-box;` +
    `box-shadow:0 0 10px 3px ${tone.glow}"></div></div>`
  );
}

/** Glowing accent dot inside a radiating accent halo, on the user's position. */
export function userDotHtml(): string {
  return haloDotHtml({
    halo: C.accentSoft30,
    fill: C.accent,
    ring: C.accentDeep,
    glow: C.accentGlow55,
  });
}
