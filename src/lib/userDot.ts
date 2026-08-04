// The « you are here » dot both maps drop on the user's position — the zone
// map (MapCanvas) and the route map (RouteMap). One markup builder for the
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

/** Accent dot inside a soft accent halo, centered on the user's position. */
export function userDotHtml(): string {
  return (
    `<div style="width:${USER_DOT_SIZE}px;height:${USER_DOT_SIZE}px;border-radius:50%;` +
    `background:${C.accentSoft15};display:flex;align-items:center;justify-content:center">` +
    `<div style="width:14px;height:14px;border-radius:50%;background:${C.accent};` +
    `border:3px solid ${C.accentDeep};box-sizing:border-box"></div></div>`
  );
}
