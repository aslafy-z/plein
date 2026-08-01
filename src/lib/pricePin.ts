// The price pin both maps drop on a station — the zone map's station pins
// (MapCanvas) and the route map's corridor stops (RouteMap). One markup
// builder so the two can never drift apart again (they had: 13px vs 11.5px,
// different paddings, different borders). Pure string builders: the callers
// wrap the HTML in an L.divIcon, and the tests read the markup directly.
//
// The label arrives already formatted (lib/format fmtPrice) so nothing here
// touches the locale.

export type PinTier = 'deal' | 'mid' | 'high';

export interface PricePinOptions {
  /** Price tier of the station — colors the bubble (green / gray / orange) */
  tier?: PinTier;
  /** Emphasized pin: the recommended station / stop — bigger type, soft glow */
  recommended?: boolean;
  /** Selected pin: accent halo ring + strong glow, and the big type too */
  focused?: boolean;
}

const DEAL_BG = '#3ddc84';
const DEAL_FG = '#08120c';
const BASE_BG = '#22282c';
const BASE_FG = '#cfd6da';
const HIGH_FG = '#e07a5f';

/** Full price bubble + tip. `deal` styling also crowns a recommended pin. */
export function pricePinHtml(label: string, opts: PricePinOptions = {}): string {
  const tier = opts.tier ?? 'mid';
  const recommended = opts.recommended ?? false;
  const focused = opts.focused ?? false;
  // The recommended pin wears the deal green whatever its tier — it must
  // agree with the green card that crowns it in the sheet / timeline
  const deal = tier === 'deal' || recommended;
  const big = recommended || focused;

  const bg = deal ? DEAL_BG : BASE_BG;
  const fg = deal ? DEAL_FG : tier === 'high' ? HIGH_FG : BASE_FG;
  const font = big
    ? "700 15px 'Spline Sans Mono',monospace"
    : "600 13px 'Spline Sans Mono',monospace";
  const pad = big ? '7px 11px' : '5px 9px';
  const border = focused
    ? `2px solid ${deal ? '#eafff3' : DEAL_BG}`
    : deal
      ? `1px solid ${DEAL_BG}`
      : tier === 'high'
        ? '1px solid rgba(224,122,95,.35)'
        : '1px solid rgba(255,255,255,.08)';
  const shadow = focused
    ? 'drop-shadow(0 6px 16px rgba(61,220,132,.55))'
    : recommended
      ? 'drop-shadow(0 4px 12px rgba(61,220,132,.35))'
      : 'none';
  const tierClass = deal ? '--deal' : tier === 'high' ? '--high' : '';
  const bubbleClass = `pin-bubble${tierClass && ` pin-bubble${tierClass}`}`;

  return (
    `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;` +
    `align-items:center;cursor:pointer;filter:${shadow}">` +
    `<div class="${bubbleClass}" style="background:${bg};color:${fg};font:${font};` +
    `padding:${pad};border:${border}">${label}</div>` +
    `<div class="pin-tip" style="border-top:7px solid ${bg}"></div></div>`
  );
}

/** Small tier-tinted dot — a station past the PIN_CAP, still tappable */
export function pricePinDotHtml(tier: PinTier = 'mid'): string {
  const tierClass = tier === 'deal' ? '--deal' : tier === 'high' ? '--high' : '';
  const dotClass = `pin-dot${tierClass && ` pin-dot${tierClass}`}`;
  return `<div style="transform:translate(-50%,-50%)"><div class="${dotClass}"></div></div>`;
}
