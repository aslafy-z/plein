// « Go there »: the URL that hands a station to a maps app. One rule for
// every app, checked by hand against Google Maps, Waze, Apple Maps and
// OpenStreetMap on a station the gouv flux puts 370 m off its pumps:
//
// - A station sitting on its OSM forecourt (`positionFromPoi`) goes by
//   coordinates, everywhere: every app routed onto the pumps. A name search
//   would only add a detour through « Did you mean » (Google) or a list where
//   other towns and other stations of the brand compete (Apple).
// - Any other point is the source's own geocode, and every app routed it
//   somewhere else without a word (a motorway interchange, a bridge, a
//   parking lot), because each one snaps a point to the nearest road. A
//   branded station with an address goes by name search instead, which found
//   the station, or at worst stopped on a list. Apple can anchor that search
//   on our point (`sll`), Android's geo: URI too; Google's and Waze's links
//   cannot.
// - OpenStreetMap always gets the point: its geocoder finds neither a brand
//   nor a house number, and its address searches landed further off than the
//   point did.
// - Nothing to search for (no brand, or no address) keeps the point: a text
//   search for « Station » would be a lottery.
import type { Station } from '../data/types';
import type { MapsSiteId } from '../state/persist';

/** Where « Go there » hands off: a desktop maps site, or Android's geo: chooser */
export type MapsHandoff = MapsSiteId | 'android';

/** The name search for a station whose point cannot be trusted; null when the point must do */
function nameQuery(s: Station): string | null {
  if (s.positionFromPoi || !s.brand || !s.address) return null;
  return encodeURIComponent([s.brand, s.address, s.postalCode, s.city].filter(Boolean).join(' '));
}

export function mapsHandoffUrl(to: MapsHandoff, s: Station): string {
  const { lat, lng } = s;
  // OSM's geocoder cannot use a name search, so it is never even built for it
  const q = to === 'osm' ? null : nameQuery(s);
  switch (to) {
    case 'android':
      // geo: anchors the search on the point; the pin carries the station's name
      return q
        ? `geo:${lat},${lng}?q=${q}`
        : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(s.name)})`;
    case 'apple':
      return q
        ? `https://maps.apple.com/?daddr=${q}&sll=${lat},${lng}&dirflg=d`
        : `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
    case 'waze':
      return q
        ? `https://www.waze.com/ul?q=${q}&navigate=yes`
        : `https://www.waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
    case 'osm':
      return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${q ?? `${lat},${lng}`}&travelmode=driving`;
  }
}
