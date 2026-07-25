import { useApp } from '../state/store';
import { C, ctaStyle, mono } from '../theme';
import { m } from '../paraglide/messages.js';
import { LogoLockup } from '../components/Logo';

export default function Onboarding() {
  const app = useApp();
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
        padding: '26px 26px 22px',
        overflow: 'auto',
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
          maxWidth: 300,
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
          marginTop: 'auto',
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
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: C.mut,
            padding: 4,
          }}
        >
          {m.onboarding_skip_location()}
        </button>
      </div>
    </div>
  );
}
