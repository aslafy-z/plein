import { C } from '../theme';
import { useApp, type Screen } from '../state/store';

const ITEMS: { key: 'map' | 'list' | 'route' | 'settings'; label: string; iconR: string }[] = [
  { key: 'map', label: 'Carte', iconR: '4px' },
  { key: 'list', label: 'Liste', iconR: '2px' },
  { key: 'route', label: 'Trajet', iconR: '50%' },
  { key: 'settings', label: 'Réglages', iconR: '7px' },
];

export default function NavBar() {
  const app = useApp();
  const target = (k: (typeof ITEMS)[number]['key']): Screen =>
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
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: it.iconR,
                  border: `2.5px solid ${active ? C.accent : C.faint}`,
                }}
              />
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
