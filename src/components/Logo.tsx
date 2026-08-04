// Brand — concept « 2a Goutte-repère » (Claude Design, Explorations §2):
// a fuel drop punched like a map pin — « le carburant, localisé ».
import { C } from '../theme';

/** The drop-pin glyph path (viewBox 0 0 64 64, fill-rule evenodd) */
export const LOGO_PATH =
  'M32 6 C32 6 11 27 11 39 a21 21 0 0 0 42 0 C53 27 32 6 32 6 Z ' +
  'M32 48 a9 9 0 1 1 0-18 a9 9 0 0 1 0 18 Z';

// The adaptive-icon's dark-green tile stays in the icon files; in the app the
// glyph sits directly on the themed surface — a near-black tile read as a
// black square on the light Réglages page.

export function LogoGlyph({ size = 24, color = C.accent }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 64 64" style={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      {/* Color via style: a var() token resolves in CSS, not in an attribute */}
      <path style={{ fill: color }} fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}

/**
 * Glyph + « Plein. » wordmark. `tagline` stacks a line under the wordmark and
 * `glow` haloes the glyph in accent light — the hero variant (Réglages
 * header); chrome (SideNav, Onboarding) passes neither. `tile` keeps naming
 * the box the glyph centers in, so the lockup's geometry is unchanged.
 */
export function LogoLockup({
  tile = 36,
  glyph = 24,
  fontSize = 17,
  tagline,
  glow = false,
}: {
  tile?: number;
  glyph?: number;
  fontSize?: number;
  tagline?: string;
  glow?: boolean;
}) {
  const wordmark = (
    <span style={{ fontSize, fontWeight: 800, color: C.ink, letterSpacing: '-.02em' }}>
      Plein<span style={{ color: C.accent }}>.</span>
    </span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: tagline != null ? 14 : 10 }}>
      <div
        style={{
          width: tile,
          height: tile,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          // drop-shadow follows the drop itself — a box-shadow would draw a
          // square halo around a box that no longer paints anything
          ...(glow ? { filter: `drop-shadow(0 6px 20px ${C.accentGlow28})` } : undefined),
        }}
      >
        <LogoGlyph size={glyph} />
      </div>
      {tagline == null ? (
        wordmark
      ) : (
        <div style={{ minWidth: 0 }}>
          <div style={{ lineHeight: 1.1 }}>{wordmark}</div>
          <div style={{ fontSize: 12.5, color: C.mut, marginTop: 3 }}>{tagline}</div>
        </div>
      )}
    </div>
  );
}
