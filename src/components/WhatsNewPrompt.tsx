import { useApp } from '../state/store';
import { m } from '../paraglide/messages.js';
import { C } from '../theme';

/**
 * Names the newest changelog entry a returning user has not seen yet — the
 * same app-level bar as the update offer above it, on both arrangements.
 *
 * The update bar says a newer build exists; this one says what that build
 * changed, once it is the one running. So the reload the update bar offers
 * lands right on it — and so does any later cold start, for the many users
 * who never tap « Reload » and get the new build the next time they open the
 * app. « See » opens the sheet that lists it; either action marks the log as
 * seen, and the bar does not come back until a new entry ships.
 */
export default function WhatsNewPrompt() {
  const app = useApp();
  const latest = app.whatsNew[0];
  // Never during the walkthrough: a newcomer has nothing to compare against
  // (onboarding stamps the log as seen on its way out anyway)
  if (!latest || app.screen === 'onboarding') return null;

  return (
    <div
      role="status"
      style={{
        background: C.accentSoft09,
        borderBottom: `1px solid ${C.accentBorder}`,
        color: C.body,
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
      <span
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {m.whatsnew_banner({ title: latest.title() })}
      </span>
      <button
        onClick={() => app.setWhatsNewOpen(true)}
        style={{ color: C.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        {m.whatsnew_banner_open()}
      </button>
      <button
        onClick={() => app.dismissWhatsNew()}
        aria-label={m.whatsnew_banner_dismiss_aria()}
        title={m.whatsnew_banner_dismiss_aria()}
        style={{ color: C.mut, fontWeight: 700, fontSize: 13, padding: '0 2px', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}
