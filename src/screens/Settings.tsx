import { C, mono } from '../theme';
import { ALL_FUELS, type DataSourceId, type VehicleId } from '../data/types';
import { useApp, MAPS_SITE_IDS, mapsSiteLabel, VEHICLE_PRESETS } from '../state/store';
import { fmtDecimal } from '../lib/format';
import { fuelLabel, sourceSublabel, sourceTitle, vehicleLabel } from '../lib/labels';
import { CONTENT_MAX_WIDTH, useIsDesktop } from '../lib/layout';
import { LOCALES, type Locale } from '../lib/locale';
import { m } from '../paraglide/messages.js';
import { HAS_NATIVE_MAPS } from '../lib/env';
import { APP_VERSION } from '../lib/appUpdate';

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

const SOURCES: DataSourceId[] = ['auto', 'fra', 'esp', 'and', 'demo'];

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
    default:
      return m.locale_name_fr({}, { locale: 'fr' });
  }
}

export default function Settings() {
  const app = useApp();
  const desktop = useIsDesktop();
  const { fuel, vehicle, tank, consumption, alerts, backgroundLocation, sourceId, geoStatus, mapsSite } = app;
  // Slider ranges follow the profile (a motorcycle tank is far smaller than a car's)
  const tankRange =
    vehicle === 'motorcycle' ? { min: 5, max: 30, step: 1 } : { min: 30, max: 80, step: 5 };
  const otherVehicle: VehicleId = vehicle === 'car' ? 'motorcycle' : 'car';
  const otherPreset = VEHICLE_PRESETS[otherVehicle];

  // `soon`: feature not built yet — activating shows a toast, like « Signaler »
  const toggles: { label: string; sub: string; on: boolean; set: (v: boolean) => void; soon: string }[] = [
    {
      label: m.settings_alerts_title(),
      sub: m.settings_alerts_sub(),
      on: alerts,
      set: app.setAlerts,
      soon: m.toast_alerts_soon(),
    },
    {
      label: m.settings_background_location_title(),
      sub: m.settings_background_location_sub(),
      on: backgroundLocation,
      set: app.setBackgroundLocation,
      soon: m.toast_background_location_soon(),
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
              borderBottom: '1px solid rgba(255,255,255,.06)',
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
            {/* « Langue du navigateur » is the absence of a choice, not a
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

      {/* Routes — desktop only: on mobile « Y aller » opens the native GPS app */}
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

      {/* Notifications */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>{m.settings_notifications_section()}</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {toggles.map((t) => (
            <button
              key={t.label}
              onClick={() => {
                if (!t.on) app.notify(t.soon);
                t.set(!t.on);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,.06)',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{t.label}</div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{t.sub}</div>
              </div>
              <div
                style={{
                  width: 44,
                  height: 26,
                  borderRadius: 13,
                  background: t.on ? C.accent : C.toggleOff,
                  flexShrink: 0,
                  position: 'relative',
                  transition: 'background .15s',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: t.on ? 21 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: C.ink,
                    transition: 'left .15s',
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

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
          {/* The demo dataset is a debug/fallback tool — only shown to users
              who already have it selected, so they can switch back to the
              real source (it stays the automatic fallback when gouv is down). */}
          {SOURCES.filter((src) => src !== 'demo' || sourceId === 'demo').map((src) => {
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
                  borderBottom: '1px solid rgba(255,255,255,.06)',
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
                    border: `2px solid ${selected ? C.accent : 'rgba(255,255,255,.25)'}`,
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

          {app.stations.fellBack && (
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: C.warn,
                padding: '10px 16px',
                borderBottom: '1px solid rgba(255,255,255,.06)',
                lineHeight: 1.4,
              }}
            >
              {m.settings_fell_back()}
            </div>
          )}

          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,.06)',
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

          <button
            onClick={() => app.notify(m.toast_price_report_soon())}
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
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: C.ink }}>
              {m.settings_report_price()}
            </span>
            <span style={{ color: C.faint }}>›</span>
          </button>
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
            zadkiel.fr
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
          {m.settings_credits_misc()}{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={CREDIT_LINK}>OpenStreetMap</a> · © CARTO
        </div>
        <div>
          {m.settings_credits_version()}{' '}
          <a
            href={`https://github.com/aslafy-z/plein/commit/${APP_VERSION.split('+')[0]}`}
            target="_blank"
            rel="noreferrer"
            title={m.settings_credits_commit_title()}
            style={{
              color: C.mut,
              textDecoration: 'underline',
              fontFamily: "'Spline Sans Mono', ui-monospace, monospace",
            }}
          >
            {APP_VERSION}
          </a>
        </div>
      </div>
    </div>
  );
}
