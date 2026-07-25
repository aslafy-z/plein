// Fuel economics shared by the nearby recommendation (map / list view) and
// the route fuel-stop optimizer. Both features answer the same question —
// « is this pump worth the drive? » — so the road-scale factor, the safety
// reserve and the money units live here, in one place, instead of drifting
// apart between the two rankings.

/**
 * Crow-flies → road distance. A real drive runs 20–40 % longer than the
 * straight line (rivers, ring roads, one-ways). Everything that mixes
 * measured road distances with crow-flies estimates lifts the estimates onto
 * the road scale with this factor first.
 */
export const CROW_ROAD_FACTOR = 1.3;

/**
 * Safety reserve: a leg may burn at most (1 − RESERVE_FRACTION) of the fuel
 * present when it starts. This is the same 20 % margin the route setup screen
 * has always shown (`limitKm = autonomyKm × 0.8`), made explicit: it covers
 * congestion, climbs and gauge optimism, and it means the tank can never be
 * planned to run dry.
 */
export const RESERVE_FRACTION = 0.2;

/** Minutes spent actually refuelling at a stop (driving to the pump excluded) */
export const REFUEL_STOP_MIN = 4;

/**
 * € value of one minute of extra travel, for the « balanced » strategy —
 * 0.35 €/min ≈ 21 €/h. A ranking weight, not cash the user pays: it never
 * appears in a displayed monetary total.
 */
export const VALUE_OF_TIME_CENTS_PER_MIN = 35;

/** €/L float from a feed → integer milli-euros per litre (1.896 → 1896) */
export function priceMilliPerLitre(value: number): number {
  return Math.round(value * 1000);
}

/** Litres burnt to drive `distanceKm` at the configured average consumption */
export function litresForKm(distanceKm: number, consumptionLitresPer100Km: number): number {
  return (distanceKm * consumptionLitresPer100Km) / 100;
}

/**
 * How far `fuelLitres` safely takes the vehicle while honouring the reserve.
 * The explicit form of the legacy « limite d'autonomie » line.
 */
export function usableRangeKm(fuelLitres: number, consumptionLitresPer100Km: number): number {
  return (fuelLitres * (1 - RESERVE_FRACTION) * 100) / consumptionLitresPer100Km;
}

/**
 * A single leg is safe when the vehicle can complete it without eating into
 * the reserve share of the fuel it set off with.
 */
export function legIsFeasible(departureFuelLitres: number, fuelNeededLitres: number): boolean {
  return fuelNeededLitres <= departureFuelLitres * (1 - RESERVE_FRACTION) + 1e-9;
}

/**
 * Per-litre price with the trip to the pump folded in: the fuel burnt driving
 * there and back (consumption & tank size from Réglages) is bought at that
 * station's own price — what a full tank ACTUALLY costs per litre. Shared by
 * the map recommendation and the « Recommandé » sort of the Favoris.
 */
export function effectiveLiterPrice(
  cfg: { consumption: number; tank: number },
  price: number,
  distKm: number,
): number {
  return price * (1 + (distKm * 2 * cfg.consumption) / 100 / cfg.tank);
}
