import { C, mono } from '../theme';
import { ALL_FUELS, FUEL_LABELS, type DataSourceId } from '../data/types';
import { useApp, MAPS_SITES, VEHICLE_PRESETS } from '../state/store';
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

const GEO_STATUS_LABELS = {
  granted: 'activée — la carte suit votre position',
  denied: 'refusée pour ce site',
  unavailable: 'indisponible sur cet appareil',
  pending: 'non demandée',
} as const;

const SOURCES: { id: DataSourceId; title: string; sub: string }[] = [
  {
    id: 'auto',
    title: 'Automatique',
    sub: 'France + Espagne + Allemagne combinées selon la zone affichée',
  },
  {
    id: 'fra',
    title: 'prix-carburants.gouv.fr',
    sub: 'temps réel · mis à jour toutes les 10 min',
  },
  {
    id: 'esp',
    title: 'geoportalgasolineras.es',
    sub: 'Espagne · officiel MITECO · toutes les 30 min',
  },
  {
    id: 'deu',
    title: 'tankerkoenig.de',
    sub: 'Allemagne · données officielles MTS-K · temps réel',
  },
  {
    id: 'demo',
    title: 'Données de démonstration',
    sub: 'hors-ligne · jeu de données fictif',
  },
];

export default function Settings() {
  const app = useApp();
  const { fuel, vehicle, tank, conso, alerts, bgloc, sourceId, geoStatus, mapsSite } = app;
  // Slider ranges follow the profile (a moto tank is far smaller than a car's)
  const tankRange = vehicle === 'moto' ? { min: 5, max: 30, step: 1 } : { min: 30, max: 80, step: 5 };

  // `soon`: feature not built yet — activating shows a toast, like « Signaler »
  const toggles: { label: string; sub: string; on: boolean; set: (v: boolean) => void; soon: string }[] = [
    {
      label: 'Alerte prix bas',
      sub: 'quand une de vos stations favorites baisse son prix',
      on: alerts,
      set: app.setAlerts,
      soon: 'Bientôt ! Les alertes ne sont pas encore actives.',
    },
    {
      label: 'Localisation en arrière-plan',
      sub: 'suggestions de plein pendant la conduite',
      on: bgloc,
      set: app.setBgloc,
      soon: "Bientôt ! Cette fonction n'est pas encore active.",
    },
  ];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '16px 20px 20px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>Réglages</div>

      {/* Véhicule */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>Véhicule</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
            Profil
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {([['car', 'Voiture'], ['moto', 'Moto']] as const).map(([v, label]) => {
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
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: -10, marginBottom: 14 }}>
            changer de profil applique {FUEL_LABELS[VEHICLE_PRESETS[vehicle === 'car' ? 'moto' : 'car'].fuel]}
            · réservoir {VEHICLE_PRESETS[vehicle === 'car' ? 'moto' : 'car'].tank} L
            · {VEHICLE_PRESETS[vehicle === 'car' ? 'moto' : 'car'].conso.toFixed(1).replace('.', ',')} L/100 km
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
            Carburant par défaut
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
                  {FUEL_LABELS[f]}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>Réservoir</span>
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
            sert au calcul des économies par plein
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 18, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>
              Consommation moyenne
            </span>
            <span style={{ font: mono(700, 15), color: C.accent }}>
              {conso.toFixed(1).replace('.', ',')} L/100 km
            </span>
          </div>
          <input
            type="range"
            min={3}
            max={12}
            step={0.5}
            value={conso}
            onChange={(e) => app.setConso(+e.target.value)}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>
            sert au calcul de l'autonomie et du coût carburant du trajet
          </div>
        </div>
      </div>

      {/* Localisation */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>Localisation</div>
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
                Position de l'appareil
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: geoStatus === 'granted' ? C.accent : geoStatus === 'pending' ? C.faint : C.warn,
                  marginTop: 2,
                }}
              >
                {GEO_STATUS_LABELS[geoStatus]}
              </div>
            </div>
            {geoStatus !== 'granted' && (
              <span style={{ color: C.accent, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                Activer
              </span>
            )}
          </button>
          <div style={{ fontSize: 11.5, color: C.faint, padding: '10px 16px', lineHeight: 1.5 }}>
            Sans localisation, la carte s'ouvre sur la dernière zone consultée (par défaut :
            Toulouse). Si la demande n'apparaît plus, autorisez la localisation pour ce site dans
            les réglages du navigateur.
          </div>
        </div>
      </div>

      {/* Itinéraires — desktop only: on mobile « Y aller » opens the native GPS app */}
      {!HAS_NATIVE_MAPS && (
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>Itinéraires</div>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
            Site pour « Y aller »
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MAPS_SITES.map((site) => {
              const active = site.id === mapsSite;
              return (
                <button
                  key={site.id}
                  onClick={() => app.setMapsSite(site.id)}
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
                  {site.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10 }}>
            site ouvert par le bouton « Y aller »
          </div>
        </div>
      </div>
      )}

      {/* Notifications */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>Notifications</div>
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

      {/* Données */}
      <div style={{ marginTop: 18 }}>
        <div style={SECTION_LABEL}>Données</div>
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
          {SOURCES.filter((src) => src.id !== 'demo' || sourceId === 'demo').map((src) => {
            const selected = sourceId === src.id;
            return (
              <button
                key={src.id}
                onClick={() => app.setSourceId(src.id)}
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
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{src.title}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{src.sub}</div>
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
              Source temps réel indisponible actuellement — bascule automatique sur la démo.
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
            <span style={{ fontWeight: 700, color: C.body }}>Un mot sur les prix</span> — ils
            proviennent des déclarations officielles des stations et sont donnés à titre
            indicatif, sans garantie : nous ne pouvons pas les vérifier un par un, et il peut
            arriver qu'un prix ait changé le temps d'arriver à la pompe. Jetez-y un œil sur
            place avant de faire le plein — le détour reste à votre appréciation. Et si un prix
            vous semble faux, dites-le-nous juste en dessous 💚
          </div>

          <button
            onClick={() => app.notify('Merci ! Le signalement arrive bientôt.')}
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
              Signaler un prix erroné
            </span>
            <span style={{ color: C.faint }}>›</span>
          </button>
        </div>
      </div>

      {/* Application */}
      {app.installReady && (
        <div style={{ marginTop: 18 }}>
          <div style={SECTION_LABEL}>Application</div>
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
                  Installer l'application
                </div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                  sur l'écran d'accueil, en plein écran
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
          Made with ❤️ in Toulouse par{' '}
          <a
            href="https://zadkiel.fr"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.mut, textDecoration: 'underline' }}
          >
            zadkiel.fr
          </a>
        </div>
        <div>
          Prix : <a href="https://prix-carburants.gouv.fr" target="_blank" rel="noreferrer" style={{ color: C.ghost, textDecoration: 'underline' }}>prix-carburants.gouv.fr</a>
          {' '}· <a href="https://geoportalgasolineras.es" target="_blank" rel="noreferrer" style={{ color: C.ghost, textDecoration: 'underline' }}>geoportalgasolineras.es</a>
          {' '}· <a href="https://creativecommons.tankerkoenig.de" target="_blank" rel="noreferrer" style={{ color: C.ghost, textDecoration: 'underline' }}>tankerkoenig.de</a> (MTS-K)
          {' '}· à titre indicatif · adresses : BAN / CartoCiudad / Photon · itinéraires : OSRM / Valhalla
        </div>
        <div>
          cartes : © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{ color: C.ghost, textDecoration: 'underline' }}>OpenStreetMap</a> · © CARTO
        </div>
        <div>
          Plein. · version{' '}
          <a
            href={`https://github.com/aslafy-z/plein/commit/${APP_VERSION.split('+')[0]}`}
            target="_blank"
            rel="noreferrer"
            title="Voir le commit sur GitHub"
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
