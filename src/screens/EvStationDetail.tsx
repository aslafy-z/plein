import { C, mono } from '../theme';
import {
  ALL_CONNECTORS,
  CONNECTOR_LABELS,
  TIER_LABELS,
  type ChargeStation,
} from '../data/types';
import { useApp } from '../state/store';
import { fmtPrice, kwLabel, distLabel, agoLabel } from '../lib/format';
import { haversineKm } from '../lib/geo';
import { openStatus } from '../lib/hours';
import Star from '../components/Star';
import { StationMiniMap } from './StationDetail';

/** Reference charge used for the « coût d'une charge » estimate (typical
 * 20 → 80 % session on a compact EV battery) */
const TYPICAL_CHARGE_KWH = 40;

const chipStyle: React.CSSProperties = {
  background: C.surface2,
  color: C.body,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 10px',
  borderRadius: 14,
  border: `1px solid ${C.border09}`,
  whiteSpace: 'nowrap',
};

/** Detail screen of a charge station — the €/kWh sibling of StationDetail
 * (no fuel table: price + provenance, connectors, power). */
export default function EvStationDetail({ s }: { s: ChargeStation }) {
  const app = useApp();

  const distKm = haversineKm(app.userPos, { lat: s.lat, lng: s.lng });
  const driveMin = Math.max(1, Math.round(distKm * 2));
  const status = openStatus(s.hours);
  const price = s.price;

  const sourceText =
    app.charge.activeSource === 'demo'
      ? 'données de démonstration'
      : 'source : base nationale IRVE (data.gouv.fr)';

  // « tarif réseau, relevé le 12/07 » — grid prices carry a survey date, not a
  // live feed timestamp; being explicit about provenance is part of the deal.
  let priceNote: string | null = null;
  if (price?.source === 'declared') priceNote = `déclaré par l'opérateur · MàJ ${agoLabel(price.updatedAt)}`;
  else if (price?.source === 'grid') {
    const d = price.updatedAt ? new Date(price.updatedAt) : null;
    priceNote = d
      ? `tarif réseau · relevé le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
      : 'tarif réseau';
  }

  const connectors = ALL_CONNECTORS.filter((c) => (s.connectors[c] ?? 0) > 0);

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: '#101214', zIndex: 1200, overflow: 'auto' }}
    >
      {/* Header mini-map */}
      <div style={{ position: 'relative', height: 160, background: C.mapBg }}>
        <StationMiniMap station={s} />
        <button
          onClick={() => {
            app.setSearchArea({ lat: s.lat, lng: s.lng }, s.name);
            app.setFocusStation(s.id);
            app.go('map');
          }}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 26,
            zIndex: 1000,
            background: '#101214d9',
            color: C.accent,
            fontSize: 12,
            fontWeight: 700,
            padding: '7px 12px',
            borderRadius: 16,
            border: `1px solid ${C.accentBorder}`,
          }}
        >
          Voir sur la carte ›
        </button>
        <button
          onClick={() => app.back()}
          aria-label="Retour"
          style={{
            position: 'absolute',
            left: 14,
            top: 14,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#101214d9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: C.ink,
            fontSize: 18,
            zIndex: 1000,
          }}
        >
          ←
        </button>
        <button
          onClick={() =>
            app.toggleFavorite({
              id: s.id,
              name: s.name,
              init: s.init,
              city: s.city,
              lat: s.lat,
              lng: s.lng,
            })
          }
          aria-label={app.isFavorite(s.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          style={{
            position: 'absolute',
            right: 14,
            top: 14,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#101214d9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <Star filled={app.isFavorite(s.id)} color={app.isFavorite(s.id) ? C.accent : C.ink} size={19} />
        </button>
      </div>

      <div style={{ padding: '18px 20px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Title + chips */}
        <div>
          <div style={{ color: C.ink, fontSize: 21, fontWeight: 700 }}>{s.name}</div>
          {s.address && (
            <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>
              {s.address}
              {s.cp || s.city ? ` · ${[s.cp, s.city].filter(Boolean).join(' ')}` : ''}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {status && (
              <span
                style={{
                  background: status.open ? C.accentSoft14 : 'rgba(224,122,95,.14)',
                  color: status.open ? C.accent : C.warn,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '5px 10px',
                  borderRadius: 14,
                  whiteSpace: 'nowrap',
                }}
              >
                {status.label}
              </span>
            )}
            <span style={chipStyle}>{`${distLabel(distKm)} · ${driveMin} min`}</span>
            {s.operator && <span style={chipStyle}>{s.operator}</span>}
            {s.pmr && <span style={chipStyle}>Accès PMR</span>}
          </div>
        </div>

        {/* Price card */}
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.ink, fontSize: 15, fontWeight: 600 }}>
                {price?.source === 'free' ? 'Recharge gratuite' : 'Prix de la recharge'}
              </div>
              {priceNote && (
                <div style={{ color: C.mut, fontSize: 11.5, marginTop: 2 }}>{priceNote}</div>
              )}
              {price?.source === 'grid' && price.sourceUrl && (
                <a
                  href={price.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.faint, fontSize: 11, textDecoration: 'underline' }}
                >
                  grille tarifaire du réseau ›
                </a>
              )}
              {price == null && (
                <div style={{ color: C.mut, fontSize: 11.5, marginTop: 2 }}>
                  prix non communiqué par l'opérateur
                </div>
              )}
            </div>
            <span style={{ font: mono(700, 22), color: C.accent, whiteSpace: 'nowrap' }}>
              {price == null
                ? '—'
                : price.source === 'free'
                  ? '0 €'
                  : `${fmtPrice(price.value)} € / kWh`}
            </span>
          </div>
          {price != null && price.value > 0 && (
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid rgba(255,255,255,.06)',
                color: C.mut,
                fontSize: 12.5,
              }}
            >
              ≈ {fmtPrice(price.value * TYPICAL_CHARGE_KWH)} € pour une charge de{' '}
              {TYPICAL_CHARGE_KWH} kWh
            </div>
          )}
          {price == null && s.pricingText && (
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid rgba(255,255,255,.06)',
                color: C.mut,
                fontSize: 12.5,
                fontStyle: 'italic',
              }}
            >
              « {s.pricingText} »
            </div>
          )}
          <div style={{ padding: '10px 16px', background: '#15181b', color: C.mut, fontSize: 11.5 }}>
            {`Mis à jour ${agoLabel(s.updatedAt)} · ${sourceText}`}
          </div>
        </div>

        {/* Charge points */}
        <div>
          <div
            style={{
              color: C.mut,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Points de charge
          </div>
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,.06)',
              }}
            >
              <span style={{ flex: 1, color: C.ink, fontSize: 15, fontWeight: 600 }}>
                Puissance max
              </span>
              <span style={{ color: C.mut, fontSize: 11.5, fontWeight: 600 }}>
                {TIER_LABELS[s.tier]}
              </span>
              <span style={{ font: mono(700, 18), color: C.accent, whiteSpace: 'nowrap' }}>
                {kwLabel(s.maxPowerKw)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderBottom: connectors.length ? '1px solid rgba(255,255,255,.06)' : 'none',
              }}
            >
              <span style={{ flex: 1, color: C.ink, fontSize: 15, fontWeight: 600 }}>
                Points de charge
              </span>
              <span style={{ font: mono(700, 18), color: C.ink }}>{s.pdcCount}</span>
            </div>
            {connectors.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px' }}>
                {connectors.map((c) => (
                  <span key={c} style={chipStyle}>
                    {CONNECTOR_LABELS[c]}
                    {(s.connectors[c] ?? 0) > 1 ? ` × ${s.connectors[c]}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Access conditions */}
        {s.access && (
          <div style={{ color: C.mut, fontSize: 12.5 }}>
            Accès : {s.access.replace(/_/g, ' ')}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={() =>
            app.openInMaps({
              name: s.name,
              lat: s.lat,
              lng: s.lng,
              address: s.address,
              city: s.city,
              cp: s.cp,
              brand: s.operator,
            })
          }
          style={{
            width: '100%',
            background: C.accent,
            color: C.onAccent,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 26,
            padding: '15px 0',
            textAlign: 'center',
          }}
        >
          Y aller
        </button>
      </div>
    </div>
  );
}
