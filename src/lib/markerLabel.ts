// Accessible name of an interactive map marker. Leaflet makes every marker a
// `tabindex=0 role=button` unless `keyboard: false`, and for a divIcon it
// offers no name of its own: `alt` only lands on an <img> icon, and `title`
// loses to the icon's text content — a price pin read « 1.67, button », a dot
// pin read nothing. `aria-label` on the icon element is what reaches the
// focusable node.
//
// The element only exists while the marker is on a map, so the label is kept
// here and re-applied on every `add`. `setIcon` reuses the same <div>, so the
// attribute survives an icon swap — the keyed marker diff stays untouched.

import type L from 'leaflet';

const labels = new WeakMap<L.Marker, string>();

function apply(marker: L.Marker) {
  const label = labels.get(marker);
  if (label != null) marker.getElement()?.setAttribute('aria-label', label);
}

/** Name `marker` for assistive tech — now if it is on a map, and on every add. */
export function setMarkerLabel(marker: L.Marker, label: string): void {
  if (!labels.has(marker)) marker.on('add', () => apply(marker));
  labels.set(marker, label);
  apply(marker);
}
