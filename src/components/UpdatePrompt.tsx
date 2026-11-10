import { useEffect, useState } from 'react';
import { watchForUpdate } from '../lib/appUpdate';
import { m } from '../paraglide/messages.js';
import { C } from '../theme';

/**
 * Offers a reload once a newer build is deployed. The reload is never automatic:
 * it would drop an in-progress route or search under the user's thumb.
 */
export default function UpdatePrompt() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => watchForUpdate(() => setOutdated(true)), []);

  // The live region is mounted from the start and only its content arrives
  // with the update: a region inserted together with its text is not
  // announced by several screen readers. Empty, it takes no room in the column.
  return (
    <div role="status" style={{ flexShrink: 0, zIndex: 40 }}>
      {outdated && <UpdateBar />}
    </div>
  );
}

function UpdateBar() {
  return (
    <div
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
      <span style={{ flex: 1 }}>{m.update_available()}</span>
      <button
        onClick={() => location.reload()}
        style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
      >
        {m.update_reload()}
      </button>
    </div>
  );
}
