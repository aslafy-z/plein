// The pin the zone map drops on the place the search picked. Pure string
// builder, like lib/pricePin and lib/userDot: the caller wraps the HTML in an
// L.divIcon, and the tests read the markup directly.
//
// Deliberately nothing like the other markers: a price pin is a bubble, the
// user is an accent dot, and this is a neutral ink teardrop — a place, not a
// station and not a price tier. Colors are C tokens set through `style` (a
// var() cannot resolve in an SVG presentation attribute), so the pin re-tints
// with the theme.

import { C } from '../theme';

/** Side of the icon box: the touch target, wider than the drawn teardrop */
export const PLACE_PIN_BOX = 44;
/** The teardrop's tip — bottom center of the box — sits on the place */
export const PLACE_PIN_ANCHOR: [number, number] = [PLACE_PIN_BOX / 2, PLACE_PIN_BOX];

/**
 * Class the caller puts on the divIcon. It styles nothing — it is the e2e's
 * handle on « is the searched place marked », which a Leaflet layer offers no
 * test id for.
 */
export const PLACE_PIN_CLASS = 'place-pin';

/** Ink teardrop with a hollow eye, tip at the bottom center of its box. */
export function placePinHtml(): string {
  return (
    `<div style="width:${PLACE_PIN_BOX}px;height:${PLACE_PIN_BOX}px;display:flex;` +
    `align-items:flex-end;justify-content:center;cursor:pointer;` +
    `filter:drop-shadow(0 3px 6px ${C.shadow50})">` +
    `<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true" style="display:block">` +
    `<path d="M14 35C14 35 2 22 2 14a12 12 0 1 1 24 0c0 8-12 21-12 21z" ` +
    `style="fill:${C.ink};stroke:${C.bg};stroke-width:2"/>` +
    `<circle cx="14" cy="14" r="4.5" style="fill:${C.bg}"/>` +
    `</svg></div>`
  );
}
