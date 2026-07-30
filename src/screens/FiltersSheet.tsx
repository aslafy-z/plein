import { useEffect, useRef, useState } from 'react';
import { C, ctaStyle, glass, mono } from '../theme';
import { ALL_FUELS, SERVICE_TAGS } from '../data/types';
import {
  useApp,
  selectAdBlueAnswerable,
  selectVisible,
  selectZoneBrandCounts,
} from '../state/store';
import { brandGroupLabel, fuelLabel, serviceTagLabel } from '../lib/labels';
import { useIsDesktop } from '../lib/layout';
import { m } from '../paraglide/messages.js';
import {
  brandIconSrc,
  INDEPENDENT_BRAND_ID,
  KNOWN_BRAND_GROUPS,
} from '../lib/brandIcons';

const sectionLabel = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: C.mut,
};

export default function FiltersSheet() {
  const app = useApp();
  const desktop = useIsDesktop();
  const nbVisible = selectVisible(app).length;
  const knowsBrands = app.stations.data.some((s) => s.brand != null);
  // AdBlue is the one service tag a source may simply not publish (France and
  // Portugal never do). Offer the chip only where the loaded stations can
  // answer, and never strand a selection made in a zone that could: an active
  // filter keeps its chip so it stays switchable off.
  const adBlueAnswerable = selectAdBlueAnswerable(app);
  const shownTags = SERVICE_TAGS.filter(
    (t) => t !== 'adBlue' || adBlueAnswerable || app.serviceTags.adBlue,
  );
  // The brand list is collapsed by default so a brand-rich zone doesn't
  // stretch the sheet — the header always shows what's selected.
  const [brandsOpen, setBrandsOpen] = useState(false);

  const close = () => app.setFiltersOpen(false);

  // Escape closes — the popover has no drag handle and the sheet's swipe
  // means nothing to a keyboard. Captured on the window: focus may still sit
  // on the map, which runs its own key loop.
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      appRef.current.setFiltersOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The popover takes focus on open, so the keyboard lands inside the thing
  // that just appeared instead of staying on the chip that opened it
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (desktop) cardRef.current?.focus({ preventScroll: true });
  }, [desktop]);

  // Brand groups present in the zone with their station count, most frequent
  // first; brandless stations count as the « independent » group, pinned last
  // so the tail never buries the real enseignes. The count answers « how many
  // stations do I get if I pick this brand » — it therefore honours the fuel
  // and service filters, and only ignores the brand selection itself.
  const counts = selectZoneBrandCounts(app);
  const zoneBrands = [...counts.entries()].sort((a, b) => {
    if (a[0] === INDEPENDENT_BRAND_ID) return 1;
    if (b[0] === INDEPENDENT_BRAND_ID) return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  // Every known group with nothing to show here — outside the radius, or
  // ruled out by the fuel/service filters — stays selectable: the selection
  // is persisted across areas and sessions, and prepares the next trip.
  const outOfZone = KNOWN_BRAND_GROUPS.filter((g) => !counts.has(g));

  const brandSummary =
    app.brandSel.length === 0
      ? m.filters_brands_all()
      : app.brandSel.slice(0, 2).map(brandGroupLabel).join(', ') +
        (app.brandSel.length > 2
          ? ` ${m.filters_brands_more({ count: app.brandSel.length - 2 })}`
          : '');

  // The filters themselves — identical in the phone's bottom sheet and in the
  // desktop dialog; only the frame around them changes.
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: C.ink, flex: 1 }}>{m.filters_title()}</span>
        <button
          onClick={() => app.resetFilters()}
          style={{ fontSize: 13, fontWeight: 700, color: C.accent }}
        >
          {m.filters_reset()}
        </button>
        {/* A sheet is dismissed by its handle, a dialog by a cross */}
        {desktop && (
          <button
            onClick={close}
            aria-label={m.filters_close_aria()}
            title={m.filters_close_aria()}
            style={{ color: C.mut, fontSize: 16, fontWeight: 700, padding: '0 2px' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Carburant */}
      <div>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>{m.filters_fuel_section()}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_FUELS.map((f) => {
            const on = app.fuel === f;
            return (
              <button
                key={f}
                onClick={() => app.setFuel(f)}
                style={{
                  background: on ? C.accent : 'transparent',
                  color: on ? C.onAccent : C.body,
                  fontSize: 13.5,
                  fontWeight: 700,
                  padding: '9px 15px',
                  borderRadius: 18,
                  border: `1px solid ${on ? C.accent : C.border12}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {fuelLabel(f)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rayon */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ ...sectionLabel, flex: 1 }}>{m.filters_radius_section()}</span>
          <span style={{ font: mono(700, 15), color: C.ink }}>{app.radius} km</span>
        </div>
        <input
          type="range"
          min={1}
          max={25}
          step={1}
          value={app.radius}
          onChange={(e) => app.setRadius(+e.target.value)}
          style={{ width: '100%', cursor: 'pointer' }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11.5,
            color: C.faint,
            marginTop: 2,
          }}
        >
          <span>{m.unit_kilometres({ km: 1 })}</span>
          <span>{m.unit_kilometres({ km: 25 })}</span>
        </div>
      </div>

      {/* Distributeurs — accordion, collapsed by default */}
      <div>
        {knowsBrands ? (
          <>
            <button
              onClick={() => setBrandsOpen((o) => !o)}
              aria-expanded={brandsOpen}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}
            >
              <span style={sectionLabel}>{m.filters_brands_section()}</span>
              <span
                style={{
                  flex: 1,
                  textAlign: 'right',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: app.brandSel.length ? C.accent : C.faint,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {brandSummary}
              </span>
              <span
                aria-hidden
                style={{
                  color: C.mut,
                  fontSize: 12,
                  transform: brandsOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform .15s',
                }}
              >
                ▾
              </span>
            </button>
            {brandsOpen && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: C.faint, marginBottom: 6 }}>
                  {m.filters_brands_hint()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {zoneBrands.map(([brand, count]) => {
                    const on = app.brandSel.includes(brand);
                    const icon = brandIconSrc(brand);
                    return (
                      <button
                        key={brand}
                        onClick={() => app.toggleBrand(brand)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '7px 2px',
                          width: '100%',
                        }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: on ? C.accent : 'transparent',
                            border: `2px solid ${on ? C.accent : 'rgba(255,255,255,.25)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: C.onAccent,
                            fontSize: 12,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {on ? '✓' : ''}
                        </div>
                        {icon && (
                          <img
                            src={icon}
                            alt=""
                            width={18}
                            height={18}
                            style={{
                              objectFit: 'contain',
                              background: '#fff',
                              borderRadius: 5,
                              padding: 1,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span
                          style={{
                            fontSize: 15,
                            color: C.ink,
                            fontWeight: 600,
                            flex: 1,
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {brandGroupLabel(brand)}
                        </span>
                        <span style={{ fontSize: 12, color: C.faint }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                {outOfZone.length > 0 && (
                  <>
                    <div style={{ fontSize: 11.5, color: C.faint, margin: '10px 0 8px' }}>
                      {m.filters_brands_out_of_zone()}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {outOfZone.map((brand) => {
                        const on = app.brandSel.includes(brand);
                        const icon = brandIconSrc(brand);
                        return (
                          <button
                            key={brand}
                            onClick={() => app.toggleBrand(brand)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              background: on ? C.accentSoft14 : 'transparent',
                              color: on ? C.accent : C.body,
                              fontSize: 12.5,
                              fontWeight: 600,
                              padding: '6px 11px',
                              borderRadius: 15,
                              border: `1px solid ${on ? C.accentBorderStrong : C.border12}`,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {icon && (
                              <img
                                src={icon}
                                alt=""
                                width={14}
                                height={14}
                                style={{
                                  objectFit: 'contain',
                                  background: '#fff',
                                  borderRadius: 4,
                                  padding: 1,
                                }}
                              />
                            )}
                            {brandGroupLabel(brand)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>{m.filters_brands_section()}</div>
            <div style={{ fontSize: 12, color: C.faint }}>{m.filters_brands_unknown()}</div>
          </>
        )}
      </div>

      {/* Services */}
      <div>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>{m.filters_services_section()}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {shownTags.map((t) => {
            const on = !!app.serviceTags[t];
            return (
              <button
                key={t}
                onClick={() => app.toggleServiceTag(t)}
                aria-pressed={on}
                style={{
                  background: on ? C.accent : 'transparent',
                  color: on ? C.onAccent : C.body,
                  fontSize: 13.5,
                  fontWeight: 600,
                  padding: '9px 15px',
                  borderRadius: 18,
                  border: `1px solid ${on ? C.accent : C.border12}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {t === 'open24h' ? m.service_open24h_filter() : serviceTagLabel(t)}
              </button>
            );
          })}
        </div>
        {/* The AdBlue caveat, only while it is being relied on: unknown
            stations are KEPT under the filter, and the user has to know which
            sources actually answered. When nothing loaded can answer at all,
            the chip is gone and the line says why — the `knowsBrands` treatment
            one section up. */}
        {adBlueAnswerable
          ? app.serviceTags.adBlue && (
              <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
                {m.filters_adblue_hint()}
              </div>
            )
          : (
            <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
              {m.filters_adblue_unknown()}
            </div>
          )}
      </div>

      <button
        onClick={close}
        style={{ ...ctaStyle(), boxShadow: '0 6px 16px rgba(61,220,132,.25)' }}
      >
        {m.filters_apply({ count: nbVisible })}
      </button>
    </>
  );

  if (desktop) {
    // A popover anchored under the chips that opened it, not a centered
    // modal: filters correct a detail of the map being looked at, so the map
    // stays fully visible — no dim, a click anywhere else closes, Escape too.
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 1100 }}>
        <button
          onClick={close}
          aria-label={m.filters_close_overlay_aria()}
          style={{ position: 'absolute', inset: 0, background: 'transparent', cursor: 'default' }}
        />
        <div
          ref={cardRef}
          role="dialog"
          aria-label={m.filters_title()}
          tabIndex={-1}
          className="anim-dialog"
          style={{
            position: 'absolute',
            top: 68,
            right: 16,
            width: 430,
            maxWidth: 'calc(100% - 32px)',
            maxHeight: 'calc(100% - 92px)',
            overflow: 'auto',
            borderRadius: 18,
            ...glass,
            background: 'rgba(16,18,20,.94)',
            outline: 'none',
            padding: '20px 22px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 1100 }}>
      <button
        onClick={close}
        aria-label={m.filters_close_overlay_aria()}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', width: '100%' }}
      />
      <div
        className="anim-sheet"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: '#15181b',
          borderRadius: '26px 26px 0 0',
          padding: '12px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxHeight: '88%',
          overflow: 'auto',
        }}
      >
        <button
          onClick={close}
          aria-label={m.filters_close_aria()}
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: 'rgba(255,255,255,.2)',
            margin: '0 auto',
          }}
        />
        {body}
      </div>
    </div>
  );
}
