import { useApp } from '../state/store';
import { C, ctaStyle, mono } from '../theme';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import { LogoLockup } from '../components/Logo';

export default function Onboarding() {
  const app = useApp();
  const desktop = useIsDesktop();
  const steps = [
    { n: '01', title: m.onboarding_step1_title(), sub: m.onboarding_step1_sub() },
    { n: '02', title: m.onboarding_step2_title(), sub: m.onboarding_step2_sub() },
    { n: '03', title: m.onboarding_step3_title(), sub: m.onboarding_step3_sub() },
  ];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        // A phone fills the screen top to bottom, so the CTA lives on the
        // bottom edge (see marginTop below). A window is too tall for that:
        // the whole pitch becomes one centered card instead.
        ...(desktop
          ? {
              justifyContent: 'center',
              maxWidth: 520,
              width: '100%',
              margin: '0 auto',
              padding: '40px 26px',
            }
          : // The phone CTA block sits on the bottom edge, so the gesture bar
            // must be padded out like every other bottom-edge chrome
            { padding: '26px 26px calc(22px + env(safe-area-inset-bottom, 0px))' }),
      }}
    >
      {/* Logo row — « 2a Goutte-repère » */}
      <LogoLockup />

      {/* Headline */}
      <div
        style={{
          marginTop: 40,
          fontSize: 36,
          lineHeight: 1.12,
          fontWeight: 800,
          color: C.ink,
          letterSpacing: '-.01em',
        }}
      >
        {m.onboarding_headline()}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 15,
          lineHeight: 1.55,
          color: C.mut,
          // Kept narrow on a phone so it doesn't run edge to edge; the desktop
          // card is already a narrow column, and 300px inside it left the
          // intro wrapping three times under a headline twice as wide
          maxWidth: desktop ? undefined : 300,
        }}
      >
        {m.onboarding_intro()}
      </div>

      {/* Steps */}
      <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {steps.map((s) => (
          <div key={s.n} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
            <span style={{ font: mono(700, 15), color: C.accent }}>{s.n}</span>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{s.title}</div>
              <div style={{ fontSize: 13, color: C.mut, marginTop: 2 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div
        style={{
          // Pushed to the bottom edge on a phone; part of the centered card
          // on a window, where `auto` would strand it a screen further down
          marginTop: desktop ? 34 : 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          paddingTop: 24,
        }}
      >
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border08}`,
            borderRadius: 14,
            padding: '13px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: C.accentSoft,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div
              style={{ width: 10, height: 10, borderRadius: '50%', border: `2.5px solid ${C.accent}` }}
            />
          </div>
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4, color: C.mut }}>
            <strong style={{ color: C.ink }}>{m.onboarding_location_title()}</strong> —{' '}
            {m.onboarding_location_body()}
          </div>
        </div>

        <button
          onClick={() => app.finishOnboarding(true)}
          style={ctaStyle()}
        >
          {m.onboarding_start()}
        </button>
        <button
          onClick={() => app.finishOnboarding(false)}
          style={{
            // Secondary pill mirroring the CTA's geometry: it must READ as a
            // button (a bare text link here was missed), while the surface2 +
            // hairline look keeps it clearly second to the green CTA
            width: '100%',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            color: C.body,
            background: C.surface2,
            border: `1px solid ${C.border12}`,
            borderRadius: 26,
            padding: '14px 0',
          }}
        >
          {m.onboarding_skip_location()}
        </button>
      </div>
    </div>
  );
}
