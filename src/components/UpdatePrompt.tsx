import { useEffect, useState } from 'react';
import { watchForUpdate } from '../lib/appUpdate';
import { C } from '../theme';

/**
 * Offers a reload once a newer build is deployed. The reload is never automatic:
 * it would drop an in-progress route or search under the user's thumb.
 */
export default function UpdatePrompt() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => watchForUpdate(() => setOutdated(true)), []);

  if (!outdated) return null;

  return (
    <div
      role="status"
      style={{
        background: C.accentSoft,
        borderBottom: `1px solid ${C.accentBorder}`,
        color: C.ink,
        fontSize: 12,
        fontWeight: 600,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        zIndex: 40,
      }}
    >
      <span style={{ flex: 1 }}>Nouvelle version disponible.</span>
      <button
        onClick={() => location.reload()}
        style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
      >
        Recharger
      </button>
    </div>
  );
}
