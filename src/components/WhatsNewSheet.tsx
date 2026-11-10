// The What's new log — every changelog entry, newest first, the ones this
// session announced flagged « New ». Opened from the map's sparkle
// (WhatsNewButton) or from Settings › What's new — never on its own; being open is nav state (`whatsNewOpen`), so the
// system Back closes it like the filters.
//
// Same split as the filters: the phone's drag-to-dismiss ModalSheet, and on a
// window a glass card. Unlike the filters it is not anchored to anything it
// corrects, so the card is centered over a dimmed stage.
import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';
import { useIsDesktop } from '../lib/layout';
import { CHANGELOG, changelogDate } from '../lib/changelog';
import { calendarDateLabel } from '../lib/format';
import { m } from '../paraglide/messages.js';
import { C, ctaStyle, glass } from '../theme';
import ModalSheet from './ModalSheet';

export default function WhatsNewSheet() {
  const app = useApp();
  const desktop = useIsDesktop();
  const close = () => app.setWhatsNewOpen(false);

  // Escape closes — captured on the window, focus may still sit on the map
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      appRef.current.setWhatsNewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (desktop) cardRef.current?.focus({ preventScroll: true });
  }, [desktop]);

  const body = (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: 0 }}>{m.whatsnew_title()}</h2>
      {CHANGELOG.map((entry, i) => (
        <section
          key={entry.id}
          aria-labelledby={`whatsnew-${entry.id}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            paddingTop: i > 0 ? 16 : 0,
            borderTop: i > 0 ? `1px solid ${C.divider}` : undefined,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <time dateTime={entry.id.slice(0, 10)} style={{ fontSize: 12, color: C.faint }}>
              {calendarDateLabel(changelogDate(entry.id))}
            </time>
            {app.whatsNewFresh.has(entry.id) && (
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
            id={`whatsnew-${entry.id}`}
            style={{ fontSize: 15.5, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.35 }}
          >
            {entry.title()}
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
            {entry.items.map((item, j) => (
              <li key={j}>{item()}</li>
            ))}
          </ul>
        </section>
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
