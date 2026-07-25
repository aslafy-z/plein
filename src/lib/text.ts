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
