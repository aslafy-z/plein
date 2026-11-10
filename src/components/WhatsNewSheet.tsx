// The What's new log, newest first, the entries this session announced
// flagged « New ». Opened from the map's sparkle (WhatsNewButton) or from
// Settings › What's new — never on its own. Being open is nav state
// (`whatsNewOpen`, which also says how it opened), so the system Back closes
// it like the filters.
//
// From the sparkle the news leads and the earlier entries wait behind « See
// earlier changes », unrolled in place; from Settings the whole history is
// open (`splitChangelog` decides which is which).
//
// Same split as the filters: the phone's drag-to-dismiss ModalSheet, and on a
// window a glass card. Unlike the filters it is not anchored to anything it
// corrects, so the card is centered over a dimmed stage.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { useIsDesktop } from '../lib/layout';
import { CHANGELOG, changelogDate, splitChangelog, type ChangelogEntry } from '../lib/changelog';
import { calendarDateLabel } from '../lib/format';
import { m } from '../paraglide/messages.js';
import { C, ctaStyle, glass } from '../theme';
import ModalSheet from './ModalSheet';

export default function WhatsNewSheet() {
  const app = useApp();
  const desktop = useIsDesktop();
  const close = () => app.setWhatsNewOpen(null);

  // Escape closes — captured on the window, focus may still sit on the map
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      appRef.current.setWhatsNewOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (desktop) cardRef.current?.focus({ preventScroll: true });
  }, [desktop]);

  const { lead, earlier } = splitChangelog(
    CHANGELOG,
    app.whatsNewFresh,
    app.whatsNewOpen ?? 'all',
  );
  const [unrolled, setUnrolled] = useState(false);
  // The unroll button goes away with the click, and focus must not fall to
  // the document: it lands on the first entry it revealed
  const firstEarlierRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (unrolled) firstEarlierRef.current?.focus({ preventScroll: true });
  }, [unrolled]);

  const entry = (e: ChangelogEntry, divided: boolean, ref?: React.Ref<HTMLElement>) => (
    <section
      key={e.id}
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      aria-labelledby={`whatsnew-${e.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        paddingTop: divided ? 16 : 0,
        borderTop: divided ? `1px solid ${C.divider}` : undefined,
        outline: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <time dateTime={e.id.slice(0, 10)} style={{ fontSize: 12, color: C.faint }}>
          {calendarDateLabel(changelogDate(e.id))}
        </time>
        {app.whatsNewFresh.has(e.id) && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: C.accent,
              background: C.accentSoft09,
              border: `1px solid ${C.accentBorder}`,
              borderRadius: 999,
              padding: '1px 7px',
            }}
          >
            {m.whatsnew_new_badge()}
          </span>
        )}
      </div>
      <h3
        id={`whatsnew-${e.id}`}
        style={{ fontSize: 15.5, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.35 }}
      >
        {e.title()}
      </h3>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 13.5,
          lineHeight: 1.45,
          color: C.body,
        }}
      >
        {e.items.map((item, j) => (
          <li key={j}>{item()}</li>
        ))}
      </ul>
    </section>
  );

  const body = (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: 0 }}>{m.whatsnew_title()}</h2>
      {lead.map((e, i) => entry(e, i > 0))}
      {earlier.length > 0 &&
        (unrolled ? (
          earlier.map((e, i) => entry(e, true, i === 0 ? firstEarlierRef : undefined))
        ) : (
          <button
            onClick={() => setUnrolled(true)}
            aria-expanded={false}
            className="press"
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13.5,
              fontWeight: 700,
              color: C.accent,
              padding: '10px 14px',
              borderRadius: 18,
              border: `1px solid ${C.accentBorder}`,
              background: C.accentSoft09,
              cursor: 'pointer',
            }}
          >
            {m.whatsnew_earlier_show()}
            <span aria-hidden>▾</span>
          </button>
        ))}
      <button onClick={close} className="press" style={ctaStyle()}>
        {m.whatsnew_done()}
      </button>
    </>
  );

  if (desktop) {
    return (
      // Centered by the flex box, not a translate: the entry keyframes
      // (.anim-dialog) own the card's transform
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 16px',
          boxSizing: 'border-box',
        }}
      >
        <button
          onClick={close}
          aria-label={m.whatsnew_close_overlay_aria()}
          style={{ position: 'absolute', inset: 0, background: C.scrimSoft, cursor: 'default' }}
        />
        <div
          ref={cardRef}
          role="dialog"
          aria-label={m.whatsnew_title()}
          tabIndex={-1}
          className="anim-dialog"
          style={{
            position: 'relative',
            width: 480,
            maxWidth: '100%',
            maxHeight: '100%',
            overflow: 'auto',
            borderRadius: 18,
            ...glass,
            background: C.glassBgStrong,
            outline: 'none',
            padding: '22px 24px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxSizing: 'border-box',
          }}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <ModalSheet
      onClose={close}
      label={m.whatsnew_title()}
      handleAria={m.whatsnew_close_aria()}
      scrimAria={m.whatsnew_close_overlay_aria()}
    >
      {body}
    </ModalSheet>
  );
}
