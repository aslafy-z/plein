import { C } from '../theme';
import { LOGO_PATH } from './Logo';
import { useApp, type Screen } from '../state/store';

type TabKey = 'map' | 'favs' | 'route' | 'settings';

/** Minimal 16px stroke pictos, tinted by the active state */
function Icon({ tab, color }: { tab: TabKey; color: string }) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    fill: 'none',
  };
  switch (tab) {
    case 'map':
      // the brand drop-pin
      return (
        <svg viewBox="0 0 64 64" width="15" height="15" aria-hidden>
          <path d={LOGO_PATH} fill={color} fillRule="evenodd" />
        </svg>
      );
    case 'favs':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
          <path
            d="M8 1.7 L9.9 5.6 L14.2 6.2 L11.1 9.2 L11.8 13.5 L8 11.4 L4.2 13.5 L4.9 9.2 L1.8 6.2 L6.1 5.6 Z"
            fill={color}
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'route':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
          <circle cx="3" cy="13" r="2" fill={color} />
          <rect x="11" y="1" width="4" height="4" rx="1.2" fill={color} />
          <path d="M4.5 11.5 C8 8, 8 8, 11.5 4.5" {...stroke} strokeDasharray="2.4 2.2" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
          <path d="M1.5 5h13M1.5 11h13" {...stroke} />
          <circle cx="10.5" cy="5" r="2.1" fill="#15181b" stroke={color} strokeWidth="2" />
          <circle cx="5.5" cy="11" r="2.1" fill="#15181b" stroke={color} strokeWidth="2" />
        </svg>
      );
  }
}

const ITEMS: { key: TabKey; label: string }[] = [
  { key: 'map', label: 'Carte' },
  { key: 'route', label: 'Trajet' },
  { key: 'favs', label: 'Favoris' },
  { key: 'settings', label: 'Réglages' },
];

export default function NavBar() {
  const app = useApp();
  const target = (k: TabKey): Screen =>
    k === 'route' ? (app.routeReady ? 'route' : 'routeSetup') : k;

  return (
    <nav
      style={{
        display: 'flex',
        background: C.navBg,
        borderTop: `1px solid ${C.border}`,
        padding: 'calc(10px) 8px calc(8px + env(safe-area-inset-bottom))',
        flexShrink: 0,
      }}
    >
      {ITEMS.map((it) => {
        const active =
          app.screen === it.key || (it.key === 'route' && app.screen === 'routeSetup');
        return (
          <button
            key={it.key}
            onClick={() => app.go(target(it.key))}
            aria-label={it.label}
            aria-current={active ? 'page' : undefined}
            style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}
          >
            <div
              style={{
                width: 34,
                height: 22,
                borderRadius: 12,
                background: active ? C.accentSoft15 : 'transparent',
                margin: '0 auto 4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon tab={it.key} color={active ? C.accent : C.faint} />
            </div>
            <span
              style={{
                fontSize: 11,
                color: active ? C.accent : C.mut,
                fontWeight: active ? 800 : 600,
              }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
