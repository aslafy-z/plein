// Label helpers shared by the station providers (French, Spanish, Andorran and
// the OSM brand enrichment all normalize the same kind of raw label).

/** "ESTACIÓN DE SERVICIO" → "Estación De Servicio" (separators kept verbatim) */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([ \-']+)/)
    .map((part) => (/^[ \-']+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** Short avatar initials for a brand or display name: "Station U" → "SU" */
export function initialsOf(label: string): string {
  const words = label.split(/[\s·-]+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes text for interpolation into an HTML string (element content or a
 * quoted attribute) — the Leaflet divIcon markup is built by hand, so any
 * upstream free text that reaches it goes through here first.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * The initials as a pin bubble may print them: two characters at most, HTML
 * escaped. The providers already cut to two, but a station rehydrated from
 * the cache or a favorite snapshot never went through them — the bound is
 * enforced at the sink. Cut by code point so a surrogate pair is never halved.
 */
export function pinInitialsHtml(init: string | undefined): string {
  return escapeHtml(Array.from(init ?? '').slice(0, 2).join(''));
}
