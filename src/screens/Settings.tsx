import { useEffect, useState } from 'react';
import { C, mono } from '../theme';
import { ALL_FUELS, type DataSourceId, type VehicleId } from '../data/types';
import { useApp, MAPS_SITE_IDS, mapsSiteLabel, VEHICLE_PRESETS } from '../state/store';
import {
  cacheStats,
  clearStationsCache,
  stationsCacheDebug,
  type StationsCacheDebug,
  type StationsCacheStats,
} from '../data/stationsCache';
import { setDebugEnabled, useDebugMode } from '../lib/debugMode';
import {
  cacheTier,
  collectSwCaches,
  fmtAgeMs,
  roundCoord,
  type DebugSnapshot,
} from '../lib/debugSnapshot';
import { clearFavoritePrices } from '../data/favoritePrices';
import { agoLabelFrom, fmtDecimal, sizeLabel } from '../lib/format';
import { fuelLabel, sourceSublabel, sourceTitle, themeLabel, vehicleLabel } from '../lib/labels';
import { THEMES } from '../lib/colorScheme';
import { CONTENT_MAX_WIDTH, useIsDesktop } from '../lib/layout';
import { LOCALES, type Locale } from '../lib/locale';
import { m } from '../paraglide/messages.js';
import { HAS_NATIVE_MAPS } from '../lib/env';
import { LogoLockup } from '../components/Logo';
import { APP_VERSION, REPO_URL } from '../lib/appUpdate';

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: C.mut,
  marginBottom: 10,
};

/** Credits links — dimmer than the body text, they sit in the footer */
const CREDIT_LINK: React.CSSProperties = { color: C.ghost, textDecoration: 'underline' };

const SOURCES: DataSourceId[] = ['auto', 'fra', 'esp', 'and', 'prt', 'demo'];

const FEEDBACK_EMAIL = 'plein@zadkiel.fr';

const VEHICLES: VehicleId[] = ['car', 'motorcycle'];

function geoStatusLabel(status: 'granted' | 'denied' | 'unavailable' | 'pending'): string {
  switch (status) {
    case 'granted':
      return m.settings_geo_granted();
    case 'denied':
      return m.settings_geo_denied();
    case 'unavailable':
      return m.settings_geo_unavailable();
    case 'pending':
      return m.settings_geo_pending();
  }
}

/**
 * Each language names itself in its own words — someone who lands on a locale
 * they can't read has to be able to find their way back out.
 */
function localeName(locale: Locale): string {
  switch (locale) {
    case 'en':
      return m.locale_name_en({}, { locale: 'en' });
    case 'es':
      return m.locale_name_es({}, { locale: 'es' });
    case 'ca':
      return m.locale_name_ca({}, { locale: 'ca' });
    case 'pt':
      return m.locale_name_pt({}, { locale: 'pt' });
    default:
      return m.locale_name_fr({}, { locale: 'fr' });
  }
}

/**
 * What the app is holding for offline use, and the way to drop it. The same
 * numbers the acceptance criteria talk about (areas, footprint, oldest fetch,
 * whether any of it survives a reload) — there is nothing else to look at,
 * since instrumentation here has to be data rather than console logs.
 */
/**
 * Extended diagnostics under the cache summary: the raw per-area records,
 * the service-worker cache counts against their sw.js caps, and a JSON copy
 * button. Assembled in English on purpose — data for a bug report, not copy
 * (the diagnostics block in the feedback mail sets the precedent), and the
 * same exemption the debug overlay lives under (CLAUDE.md, Language).
 * Coordinates are rounded to ~1 km so a screenshot of this screen cannot
 * leak the tester's exact position.
 */
function CacheDetails() {
  const [cache, setCache] = useState<StationsCacheDebug | null>(null);
  const [swCaches, setSwCaches] = useState<DebugSnapshot['storage']['swCaches']>([]);
  const [estimate, setEstimate] = useState<{ usage: number | null; quota: number | null }>({
    usage: null,
    quota: null,
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setCache(stationsCacheDebug());
    void collectSwCaches().then((next) => {
      if (live) setSwCaches(next);
    });
    void navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (live) setEstimate({ usage: est?.usage ?? null, quota: est?.quota ?? null });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const copy = async () => {
    const payload = { areaCache: cache, swCaches, storageEstimate: estimate };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — the numbers stay readable on screen */
    }
  };

  const line: React.CSSProperties = {
    font: mono(500, 11),
    color: C.mut,
    lineHeight: 1.7,
    wordBreak: 'break-all',
  };

  return (
    <div
      data-testid="cache-details"
      style={{ padding: '10px 16px', borderBottom: `1px solid ${C.divider}` }}
    >
      {cache != null && (
        <>
          <div style={line}>
            store: {cache.durable ? 'durable (IndexedDB)' : 'in-memory fallback'} ·{' '}
            {cache.hydrated ? 'hydrated' : 'hydrating'} · pending {cache.pendingPuts}+
            {cache.pendingDeletes}
          </div>
          {cache.areas.map((a) => (
            <div key={a.key} style={line}>
              {a.source} · {roundCoord(a.center.lat)},{roundCoord(a.center.lng)} · r
              {a.fetchRadiusKm} km · {a.stationCount} stations · {sizeLabel(a.bytes)} ·{' '}
              {fmtAgeMs(Date.now() - a.fetchedAt)} ago ({cacheTier(a.fetchedAt)})
              {a.payloadInMemory ? ' · in memory' : ''}
            </div>
          ))}
        </>
      )}
      {swCaches.map((c) => (
        <div key={c.name} style={line}>
          {c.name}: {c.entries}
          {c.cap != null ? `/${c.cap}` : ''} entries
        </div>
      ))}
      {estimate.usage != null && (
        // navigator.storage.estimate(): the whole origin across every storage
        // API (IndexedDB, the SW caches, tiles…), so it dwarfs the stations
        // summary above; the quota is what the browser WOULD grant, not usage
        <div style={line}>
          whole origin (browser estimate): {sizeLabel(estimate.usage)} used
          {estimate.quota != null ? ` · quota ${sizeLabel(estimate.quota)}` : ''}
        </div>
      )}
      <button
        onClick={() => void copy()}
        style={{
          marginTop: 8,
          font: mono(600, 11),
          color: C.body,
          background: C.surface2,
          border: `1px solid ${C.border12}`,
          borderRadius: 10,
          padding: '5px 10px',
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied ✓' : 'Copy JSON'}
      </button>
    </div>
  );
}

function CachedData({ onCleared }: { onCleared: () => void }) {
  const [stats, setStats] = useState<StationsCacheStats | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void cacheStats().then((next) => {
      if (live) setStats(next);
    });
    return () => {
      live = false;
    };
  }, [round]);

  const clear = async () => {
    setBusy(true);
    // Favorite prices are cache-class data too — « Clear offline data » drops both
    await Promise.all([clearStationsCache(), clearFavoritePrices()]);
    setBusy(false);
    setRound((n) => n + 1);
    onCleared();
  };

  return (
    <>
      {/* The summary row expands into the raw diagnostics on tap */}
      <button
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-label={m.settings_cache_details_toggle()}
        title={m.settings_cache_details_toggle()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: `1px solid ${C.divider}`,
          fontSize: 12,
          lineHeight: 1.55,
          color: C.mut,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-testid="cache-stats">
            {stats == null || stats.areas === 0
              ? m.settings_cache_empty()
              : m.settings_cache_summary({
                  count: stats.areas,
                  size: sizeLabel(stats.bytes),
                  age: stats.oldestFetchedAt != null ? agoLabelFrom(stats.oldestFetchedAt) : '',
                })}
          </div>
          {stats != null && !stats.durable && (
            <div style={{ color: C.warn, marginTop: 2 }}>{m.settings_cache_volatile()}</div>
          )}
        </div>
        <span
          aria-hidden="true"
          style={{
            color: C.faint,
            transform: detailsOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
            flexShrink: 0,
          }}
        >
          ›
        </span>
      </button>
      {detailsOpen && <CacheDetails key={round} />}
      <button
        onClick={() => void clear()}
        disabled={busy || stats == null || stats.areas === 0}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          cursor: stats?.areas ? 'pointer' : 'default',
          width: '100%',
          textAlign: 'left',
          opacity: stats?.areas ? 1 : 0.5,
        }}
      >
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: C.ink }}>
          {m.settings_cache_clear()}
        </span>
        <span style={{ color: C.faint }}>›</span>
      </button>
    </>
  );
}

export default function Settings() {
  const app = useApp();
  const desktop = useIsDesktop();
  const debugOn = useDebugMode();
  const { fuel, vehicle, tank, consumption, sourceId, geoStatus, mapsSite } = app;
  // Slider ranges follow the profile (a motorcycle tank is far smaller than a car's)
  const tankRange =
    vehicle === 'motorcycle' ? { min: 5, max: 30, step: 1 } : { min: 30, max: 80, step: 5 };
  const otherVehicle: VehicleId = vehicle === 'car' ? 'motorcycle' : 'car';
  const otherPreset = VEHICLE_PRESETS[otherVehicle];

  // Diagnostic block the mail and the GitHub issue both arrive with — data,
  // not copy, so it is assembled here in English rather than through the catalog
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const diagnostics = [
    '—',
    `version: ${APP_VERSION}`,
    `platform: ${nav.userAgentData?.platform || nav.platform || 'unknown'}`,
    `user agent: ${nav.userAgent}`,
  ].join('\n');
  // The message functions re-run on every render, so the prefilled mail
  // follows a locale switch without any extra wiring
  const feedbackHref = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
    m.feedback_mail_subject(),
  )}&body=${encodeURIComponent(m.feedback_mail_body({ details: diagnostics }))}`;
  const contactRows: {
    title: string;
    sub: string;
    href: string;
    external?: boolean;
    mono?: boolean;
    titleAttr?: string;
  }[] = [
    { title: m.settings_feedback_email_title(), sub: FEEDBACK_EMAIL, href: feedbackHref },
    {
      title: m.settings_feedback_github_title(),
      sub: m.settings_feedback_github_sub(),
      href: `${REPO_URL}/issues/new?body=${encodeURIComponent(`\n\n${diagnostics}`)}`,
      external: true,
    },
    {
      title: m.settings_feedback_version_title(),
      sub: APP_VERSION,
      href: `${REPO_URL}/commit/${APP_VERSION.split('+')[0]}`,
      external: true,
      mono: true,
      titleAttr: m.settings_credits_commit_title(),
    },
  ];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        // A column of settings rows, centered: on a wide window the section
        // labels and the sliders would otherwise sit a full screen apart
        maxWidth: CONTENT_MAX_WIDTH,
        width: '100%',
        margin: '0 auto',
        padding: desktop ? '26px 32px 40px' : '16px 20px 20px',
        boxSizing: 'border-box',
      }}
    >
      {/* Brand header — the one place the app shows itself off a little */}
      <div style={{ marginBottom: 22 }}>
        <LogoLockup tile={52} glyph={34} fontSize={26} tagline={m.settings_brand_tagline()} glow />
      </div>

      <div style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>{m.settings_title()}</div>

      {/* Vehicle */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_vehicle_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
            {m.settings_profile()}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {VEHICLES.map((v) => {
              const active = vehicle === v;
              return (
                <button
                  key={v}
                  onClick={() => app.setVehicle(v)}
                  style={{
                    flex: 1,
                    background: active ? C.accent : 'transparent',
                    color: active ? C.onAccent : C.body,
                    fontSize: 13.5,
                    fontWeight: 700,
                    padding: '10px 0',
                    borderRadius: 16,
                    border: active ? `1px solid ${C.accent}` : `1px solid ${C.border12}`,
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  {vehicleLabel(v)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: -10, marginBottom: 14 }}>
            {m.settings_profile_hint({
              fuel: fuelLabel(otherPreset.fuel),
              tank: otherPreset.tank,
              consumption: fmtDecimal(otherPreset.consumption, 1),
            })}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
            {m.settings_default_fuel()}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ALL_FUELS.map((f) => {
              const active = f === fuel;
              return (
                <button
                  key={f}
                  onClick={() => app.setFuel(f)}
                  style={{
                    background: active ? C.accent : 'transparent',
                    color: active ? C.onAccent : C.body,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '8px 14px',
                    borderRadius: 16,
                    border: active ? `1px solid ${C.accent}` : `1px solid ${C.border12}`,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fuelLabel(f)}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>
              {m.settings_tank()}
            </span>
            <span style={{ font: mono(700, 15), color: C.accent }}>{tank} L</span>
          </div>
          <input
            type="range"
            min={tankRange.min}
            max={tankRange.max}
            step={tankRange.step}
            value={tank}
            onChange={(e) => app.setTank(+e.target.value)}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>
            {m.settings_tank_hint()}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>
              {m.settings_consumption()}
            </span>
            <span style={{ font: mono(700, 15), color: C.accent }}>
              {fmtDecimal(consumption, 1)} L/100 km
            </span>
          </div>
          <input
            type="range"
            min={3}
            max={12}
            step={0.5}
            value={consumption}
            onChange={(e) => app.setConsumption(+e.target.value)}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>
            {m.settings_consumption_hint()}
          </div>
        </div>
      </div>

      {/* Location */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_location_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => app.requestGeolocation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              borderBottom: `1px solid ${C.divider}`,
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>
                {m.settings_device_position()}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: geoStatus === 'granted' ? C.accent : geoStatus === 'pending' ? C.faint : C.warn,
                  marginTop: 2,
                }}
              >
                {geoStatusLabel(geoStatus)}
              </div>
            </div>
            {geoStatus !== 'granted' && (
              <span style={{ color: C.accent, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                {m.settings_geo_enable()}
              </span>
            )}
          </button>
          <div style={{ fontSize: 11.5, color: C.faint, padding: '10px 16px', lineHeight: 1.5 }}>
            {m.settings_location_hint()}
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_appearance_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* « Browser setting » is the absence of a choice, not a
                theme: picking it drops the override so the browser's light or
                dark preference applies again — live, dusk included. */}
            {[null, ...THEMES].map((t) => {
              const active = t == null ? !app.themeIsExplicit : app.themeIsExplicit && app.theme === t;
              return (
                <button
                  key={t ?? 'auto'}
                  onClick={() => app.setTheme(t)}
                  style={{
                    background: active ? C.accent : 'transparent',
                    color: active ? C.onAccent : C.body,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '8px 14px',
                    borderRadius: 16,
                    border: active ? `1px solid ${C.accent}` : `1px solid ${C.border12}`,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t == null ? m.settings_theme_auto() : themeLabel(t)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10 }}>
            {m.settings_theme_hint({ auto: m.settings_theme_auto() })}
          </div>
        </div>
      </div>

      {/* Language */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_language_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* « Browser language » is the absence of a choice, not a
                locale: picking it drops the override so detection applies
                again — including after the user changes their browser. */}
            {[null, ...LOCALES].map((l) => {
              const active = l == null ? !app.localeIsExplicit : app.localeIsExplicit && app.locale === l;
              return (
                <button
                  key={l ?? 'auto'}
                  onClick={() => app.setLocale(l)}
                  style={{
                    background: active ? C.accent : 'transparent',
                    color: active ? C.onAccent : C.body,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '8px 14px',
                    borderRadius: 16,
                    border: active ? `1px solid ${C.accent}` : `1px solid ${C.border12}`,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {l == null ? m.settings_language_auto() : localeName(l)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10 }}>
            {m.settings_language_hint({ auto: m.settings_language_auto() })}
          </div>
        </div>
      </div>

      {/* Routes — desktop only: on mobile « Go there » opens the native GPS app */}
      {!HAS_NATIVE_MAPS && (
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_routes_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
            {m.settings_maps_site()}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MAPS_SITE_IDS.map((site) => {
              const active = site === mapsSite;
              return (
                <button
                  key={site}
                  onClick={() => app.setMapsSite(site)}
                  style={{
                    background: active ? C.accent : 'transparent',
                    color: active ? C.onAccent : C.body,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '8px 14px',
                    borderRadius: 16,
                    border: active ? `1px solid ${C.accent}` : `1px solid ${C.border12}`,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mapsSiteLabel(site)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10 }}>
            {m.settings_maps_site_hint()}
          </div>
        </div>
      </div>
      )}

      {/* Data */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_data_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {/* The demo dataset is a deliberate choice, never a silent
              fallback: its row shows for users who already selected it (so
              they can switch back) and while the real source is failing, as
              the explicit escape hatch. */}
          {SOURCES.filter(
            (src) => src !== 'demo' || sourceId === 'demo' || app.stations.lastError != null,
          ).map((src) => {
            const selected = sourceId === src;
            return (
              <button
                key={src}
                onClick={() => app.setSourceId(src)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderBottom: `1px solid ${C.divider}`,
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: `2px solid ${selected ? C.accent : C.border25}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  {selected && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>
                    {sourceTitle(src)}
                  </div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                    {sourceSublabel(src)}
                  </div>
                </div>
              </button>
            );
          })}

          {app.stations.lastError != null && (
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: C.warn,
                padding: '10px 16px',
                borderBottom: `1px solid ${C.divider}`,
                lineHeight: 1.4,
              }}
            >
              {m.settings_source_down()}
            </div>
          )}

          <div
            style={{
              padding: '12px 16px',
              fontSize: 12,
              lineHeight: 1.55,
              color: C.mut,
            }}
          >
            <span style={{ fontWeight: 700, color: C.body }}>
              {m.settings_price_disclaimer_title()}
            </span>
            {m.settings_price_disclaimer_body()}
          </div>
        </div>
      </div>

      {/* Offline cache — cache-class data, not a source choice, so its own
          section rather than a tail on the source picker */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_cache_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <CachedData onCleared={() => app.notify(m.toast_cache_cleared())} />
        </div>
      </div>

      {/* Contact */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_feedback_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {contactRows.map((row, i) => (
            <a
              key={row.title}
              href={row.href}
              title={row.titleAttr}
              {...(row.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderBottom:
                  i < contactRows.length - 1 ? `1px solid ${C.divider}` : undefined,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                textDecoration: 'none',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{row.title}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.faint,
                    marginTop: 2,
                    fontFamily: row.mono
                      ? "'Spline Sans Mono', ui-monospace, monospace"
                      : undefined,
                  }}
                >
                  {row.sub}
                </div>
              </div>
              <span style={{ color: C.faint }}>{row.external ? '↗' : '›'}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Application */}
      {app.installReady && (
        <div style={{ marginTop: 18 }}>
          <div style={SECTION_LABEL}>{m.settings_app_section()}</div>
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => app.promptInstall()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>
                  {m.settings_install_title()}
                </div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                  {m.settings_install_sub()}
                </div>
              </div>
              <span style={{ color: C.accent, fontWeight: 700 }}>›</span>
            </button>
          </div>
        </div>
      )}

      {/* Developer — the debug overlay switch. Session-scoped on purpose
          (sessionStorage, never the persisted blob): closing the tab turns
          it back off. */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_debug_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <button
            role="switch"
            aria-checked={debugOn}
            onClick={() => setDebugEnabled(!debugOn)}
            data-testid="debug-toggle"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>
                {m.settings_debug_overlay_title()}
              </div>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                {m.settings_debug_overlay_sub()}
              </div>
            </div>
            <span
              aria-hidden="true"
              style={{
                width: 40,
                height: 24,
                borderRadius: 12,
                background: debugOn ? C.accent : C.toggleOff,
                position: 'relative',
                flexShrink: 0,
                transition: 'background .15s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: debugOn ? 19 : 3,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: C.surface,
                  boxShadow: `0 1px 3px ${C.shadow40}`,
                  transition: 'left .15s',
                }}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Footer — credits, kept compact */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 11,
          color: C.ghost,
          marginTop: 20,
          lineHeight: 1.7,
        }}
      >
        <div style={{ color: C.faint }}>
          {m.settings_credits_made_with()}{' '}
          <a
            href="https://zadkiel.fr"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.mut, textDecoration: 'underline' }}
          >
            Zadkiel AHARONIAN
          </a>
        </div>
        {/* Credits, one line per country so each flux is named where it applies */}
        <div>
          {m.settings_credits_prices_fra()}{' '}
          <a href="https://prix-carburants.gouv.fr" target="_blank" rel="noreferrer" style={CREDIT_LINK}>prix-carburants.gouv.fr</a>
          {' '}
          {m.settings_credits_addresses({ source: 'BAN' })}
        </div>
        <div>
          {m.settings_credits_prices_esp()}{' '}
          <a href="https://geoportalgasolineras.es" target="_blank" rel="noreferrer" style={CREDIT_LINK}>geoportalgasolineras.es</a>
          {' '}
          {m.settings_credits_addresses({ source: 'CartoCiudad' })}
        </div>
        <div>
          {m.settings_credits_prices_and()}{' '}
          <a href="https://sig.govern.ad/IPE/PreusCarburants" target="_blank" rel="noreferrer" style={CREDIT_LINK}>sig.govern.ad</a>
          {' '}
          {m.settings_credits_and_extra()}
        </div>
        <div>
          {m.settings_credits_prices_prt()}{' '}
          <a href="https://precoscombustiveis.dgeg.gov.pt" target="_blank" rel="noreferrer" style={CREDIT_LINK}>precoscombustiveis.dgeg.gov.pt</a>
          {' '}
          {m.settings_credits_addresses({ source: 'Photon · OpenStreetMap' })}
        </div>
        <div>
          {m.settings_credits_misc()}{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={CREDIT_LINK}>OpenStreetMap</a> · © CARTO
        </div>
      </div>
    </div>
  );
}
