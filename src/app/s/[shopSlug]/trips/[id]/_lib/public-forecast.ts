import { automatedForecastForDeparture, hasCrewPrediction } from "@/lib/marine-forecast";
import type { AutomatedForecast, Shop, Trip } from "../_components/types";

/**
 * **What the trip page may say about the day's weather.** The crew's own read
 * wins over the automated outlook, which is started here and never awaited
 * (`ConditionsLine` streams it in its own `<Suspense>`).
 *
 * Public conditions off on the Features page hides **only the automated
 * outlook**, and it is never asked for. The crew's own read, their updates in
 * the change ledger and the "conditions changed since you booked" notice are
 * the shop speaking to its divers, and stay: a booked diver sent here from
 * `/ready`, and anybody reading a held departure whose hold notice says "see
 * the conditions update above", must find them (review 2026-10-23, item 1).
 */
export function publicForecast(
  shop: Pick<Shop, "publicConditionsEnabled">,
  trip: Trip,
): { crewPrediction: boolean; automatedForecast: Promise<AutomatedForecast> } {
  const crewPrediction = hasCrewPrediction(trip);
  return {
    crewPrediction,
    automatedForecast:
      crewPrediction || !shop.publicConditionsEnabled
        ? Promise.resolve(null)
        : automatedForecastForDeparture(trip.diveSite, trip.startsAt),
  };
}
