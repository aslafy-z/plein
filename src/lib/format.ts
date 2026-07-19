// French-locale formatting helpers

/** 1.679 -> "1,68" ; null/undefined -> "—" */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(2).replace('.', ',');
}

/** 150 -> "150 kW" ; 7.4 -> "7,4 kW" ; 0/unknown -> "— kW" */
export function kwLabel(kw: number): string {
  if (!kw || !isFinite(kw)) return '— kW';
  const v = kw >= 10 ? String(Math.round(kw)) : String(kw).replace('.', ',');
  return `${v} kW`;
}

/** 0.85 -> "850 m" ; 2.34 -> "2,3 km" */
export function distLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** 316 -> "5 h 16" ; 45 -> "45 min" */
export function durationLabel(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** "17:36"-style clock label for a Date */
export function clockLabel(d: Date): string {
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO timestamp -> "il y a 2 h" / "hier" / "il y a 3 j" */
export function agoLabel(iso: string | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return mins <= 1 ? "à l'instant" : `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
}

/** Plural helper: n + singular/plural word */
export function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n > 1 ? (pluralWord ?? singular + 's') : singular}`;
}
