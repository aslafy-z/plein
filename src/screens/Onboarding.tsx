import { useApp } from '../state/store';
import { C, mono } from '../theme';
import { LogoLockup } from '../components/Logo';

const STEPS: { n: string; title: string; sub: string }[] = [
  { n: '01', title: 'Choisissez votre carburant', sub: 'Gazole, SP95-E10, E85…' },
  { n: '02', title: 'Comparez autour de vous', sub: 'ou le long de votre itinéraire' },
  { n: '03', title: 'Faites le plein via Maps', sub: 'itinéraire direct vers la station choisie' },
];

export default function Onboarding() {
  const app = useApp();

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
        Payez votre plein au juste prix.
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
        Les prix des stations en France, en Espagne et en Andorre, comparés autour de vous et sur vos trajets.
      </div>

      {/* Steps */}
      <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {STEPS.map((s) => (
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
            <strong style={{ color: C.ink }}>Localisation</strong> — uniquement pour trouver les
            stations proches
          </div>
        </div>

        <button
          onClick={() => app.finishOnboarding(true)}
          style={{
            width: '100%',
            background: C.accent,
            color: C.onAccent,
            fontSize: 15.5,
            fontWeight: 800,
            borderRadius: 26,
            padding: '16px 0',
            textAlign: 'center',
          }}
        >
          Commencer
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
          Continuer sans localisation
        </button>
      </div>
    </div>
  );
}
