import type { CSSProperties, ReactNode } from 'react';
import { C } from '../theme';
import { SERVICE_TAGS } from '../data/types';
import { useIsDesktop } from '../lib/layout';
import { useApp, selectZoneFuels, selectZoneLoading } from '../state/store';
import { brandGroupLabel, fuelLabel, serviceTagLabel } from '../lib/labels';
import { m } from '../paraglide/messages.js';

/**
 * What the zone says when it has no station to lead with — the counterpart of
 * ZoneCard, and the WHOLE of the zone in that state: nothing follows it, no
 * list, no rows.
 *
 * Shared by the two arrangements like the card and the list are. Written as a
 * block that owns the space it is given (a mark, one sentence, what caused
 * the miss, one way out) rather than as a stranded line: the phone sheet hugs
 * it, and on desktop MapScreen lets the floating panel hug it too — a
 * full-height pane of glass around a single muted sentence reads as broken.
 *
 * The two spaces differ, though: the desktop panel has room to spend, while
 * the phone sheet sits OVER the map — collapsed with nothing to expand to
 * (no list, no handle), so it must not stand taller than the station card it
 * replaces. The phone variant drops the mark and tightens the spacing.
 */
export default function ZoneEmpty() {
  const app = useApp();

  // Transient by definition — a mark and a button would flash and leave.
  // Name the step actually under way: the first load waits on the GPS fix
  // before it even knows which area to ask for (see `geoHold`), and
  // « looking for stations » there would point at the wrong wait.
  if (selectZoneLoading(app)) {
    return (
      <div style={{ padding: '18px 20px', textAlign: 'center', color: C.mut, fontSize: 13.5 }}>
        {app.geoLocating ? m.sheet_locating() : m.sheet_loading()}
      </div>
    );
  }

  const { lastError } = app.stations;
  // Zone empty for the SELECTED fuel: which fuels are actually sold around?
  const soldFuels = selectZoneFuels(app).filter((f) => f !== app.fuel);

  // Stations around, but none sells the selected fuel (no E10/E85 outside
  // France…) — name the culprit and offer what IS sold
  if (soldFuels.length > 0) {
    return (
      <Block title={m.sheet_fuel_not_sold({ fuel: fuelLabel(app.fuel) })}>
        <div style={chipRow}>
          <span style={{ color: C.mut, fontSize: 13 }}>{m.sheet_sold_here()}</span>
          {soldFuels.map((f) => (
            <button key={f} onClick={() => app.setFuel(f)} style={fuelChipStyle}>
              {fuelLabel(f)}
            </button>
          ))}
        </div>
      </Block>
    );
  }

  // The network failed — say so. « Adjust filters » would blame the
  // user's filters for a zone the app could not load.
  if (lastError != null) {
    return (
      <Block title={lastError === 'offline' ? m.sheet_offline_empty() : m.sheet_source_empty()}>
        <button onClick={() => app.reloadStations()} style={actionStyle}>
          {m.banner_retry()}
        </button>
      </Block>
    );
  }

  // Nothing loaded around here at all: the radius is the only lever, and it
  // lives in the filters like the rest
  if (app.stations.data.length === 0) {
    return (
      <Block title={m.sheet_empty_radius()}>
        <button onClick={() => app.setFiltersOpen(true)} style={actionStyle}>
          {m.sheet_adjust_filters()}
        </button>
      </Block>
    );
  }

  return (
    <Block title={m.sheet_no_match()}>
      <ActiveFilters />
      <button onClick={() => app.setFiltersOpen(true)} style={actionStyle}>
        {m.sheet_adjust_filters()}
      </button>
    </Block>
  );
}

/**
 * What is narrowing the zone right now, so « Adjust filters » has a
 * target. The fuel is never listed: a fuel the zone doesn't sell has its own
 * branch above, so by the time this shows, the selection that matched nothing
 * is the radius, the brands and the services.
 */
function ActiveFilters() {
  const app = useApp();
  const tags = SERVICE_TAGS.filter((t) => app.serviceTags[t]);

  return (
    <div style={chipRow}>
      <span style={{ color: C.mut, fontSize: 13 }}>{m.sheet_active_filters()}</span>
      <span style={filterChipStyle}>{m.map_radius_chip({ km: app.radius })}</span>
      {app.brandSel.map((b) => (
        <span key={b} style={filterChipStyle}>
          {brandGroupLabel(b)}
        </span>
      ))}
      {tags.map((t) => (
        <span key={t} style={filterChipStyle}>
          {t === 'open24h' ? m.service_open24h_filter() : serviceTagLabel(t)}
        </span>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const isDesktop = useIsDesktop();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: isDesktop ? 14 : 10,
        padding: isDesktop ? '26px 22px 28px' : '18px 20px 18px',
      }}
    >
      {isDesktop && <EmptyZoneMark />}
      <div
        style={{
          color: C.ink,
          fontSize: 15.5,
          fontWeight: 600,
          lineHeight: 1.35,
          // A sentence dragged across the whole panel stops being one glance,
          // and a two-word orphan on the second line is no better — the
          // browser evens the lines out (ignored where unsupported)
          maxWidth: 320,
          textWrap: 'balance',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * The zone itself, drawn empty — the same search circle MapCanvas puts on the
 * map (accent stroke, barely-there fill) with the position at its center and
 * nothing else inside. The emptiness IS the illustration.
 */
function EmptyZoneMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      {/* Colors via style: a var() resolves in CSS, not in a presentation attribute */}
      <circle
        cx="28"
        cy="28"
        r="25"
        style={{ fill: C.accentSoft05, stroke: C.accentBorder30 }}
        strokeWidth="1.25"
      />
      <circle cx="28" cy="28" r="6" style={{ fill: C.accentSoft14 }} />
      <circle cx="28" cy="28" r="2.5" style={{ fill: C.accent }} />
    </svg>
  );
}

const chipRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 8,
};

/** The way out — the only accent the block spends, so it reads as the action */
const actionStyle: CSSProperties = {
  background: C.accent,
  color: C.onAccent,
  fontSize: 14.5,
  fontWeight: 700,
  borderRadius: 22,
  padding: '12px 22px',
};

/** A fuel the zone does sell: one tap switches to it */
const fuelChipStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  color: C.accent,
  background: C.surface2,
  padding: '6px 12px',
  borderRadius: 14,
  border: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
};

/** A filter that is on: a diagnosis, not a control — muted, and inert */
const filterChipStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: C.body,
  background: C.surface2,
  padding: '6px 12px',
  borderRadius: 14,
  border: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
};
