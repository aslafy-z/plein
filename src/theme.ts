// Plein. design tokens — from the Claude Design prototype (« Cap nuit » dark system)

export const C = {
  bg: '#101214', // app background
  bgDeep: '#0d0f11', // page backdrop (desktop)
  surface: '#1a1d20', // cards
  surface2: '#1d2226', // chips / secondary surfaces
  surface3: '#22282c', // tertiary (avatars, bars)
  navBg: '#15181b',
  mapBg: '#14181a',
  mapBlock: '#171c1f',
  mapRoad: '#20262a',
  mapRoadThin: '#1c2226',
  accent: '#3ddc84', // green
  accentHover: '#5fe49a',
  onAccent: '#08120c', // near-black on green
  ink: '#e8eaed', // primary text
  body: '#cfd6da', // secondary text on chips
  mut: '#8a949a', // muted text
  faint: '#5c666c', // faintest text
  ghost: '#3a4147', // footer text
  warn: '#e07a5f', // orange (expensive / destination / limits)
  warnBar: '#c96f5c',
  okBar: '#5f7f6e',
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
  sans: "Archivo, system-ui, sans-serif",
  mono: "'Spline Sans Mono', ui-monospace, monospace",
} as const;

/** Price in mono accent, e.g. font: mono(700, 22) */
export const mono = (weight: number, sizePx: number) =>
  `${weight} ${sizePx}px ${FONT.mono}`;
