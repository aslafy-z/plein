// The pin the zone map drops on the place the search picked. Pure string
// builder, like lib/pricePin and lib/userDot: the caller wraps the HTML in an
// L.divIcon, and the tests read the markup directly.
//
// A variant of the user dot (lib/userDot `haloDotHtml`): same ringed dot in a
// soft halo, in neutral ink instead of the accent — a place, not the user,
// not a station and not a price tier. Colors are C tokens, so the dot
// re-tints with the theme; the halo and the glow are the ink itself, thinned.

import { C } from '../theme';
import { haloDotHtml } from './userDot';

/** Side of the icon box: the touch target, wider than the drawn halo */
export const PLACE_PIN_BOX = 44;
/** The dot is centered in its box, and sits on the place */
export const PLACE_PIN_ANCHOR: [number, number] = [PLACE_PIN_BOX / 2, PLACE_PIN_BOX / 2];

/**
 * Class the caller puts on the divIcon. It styles nothing — it is the e2e's
 * handle on « is the searched place marked », which a Leaflet layer offers no
 * test id for.
 */
export const PLACE_PIN_CLASS = 'place-pin';

/** Glowing ink dot inside a radiating ink halo, centered in its touch box. */
export function placePinHtml(): string {
  return (
    `<div style="width:${PLACE_PIN_BOX}px;height:${PLACE_PIN_BOX}px;display:flex;` +
    `align-items:center;justify-content:center;cursor:pointer">` +
    haloDotHtml({
      halo: `color-mix(in srgb, ${C.ink} 26%, transparent)`,
      fill: C.ink,
      ring: C.bg,
      glow: `color-mix(in srgb, ${C.ink} 50%, transparent)`,
        }) +
    `</div>`
  );
}
