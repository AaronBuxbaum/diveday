import { automatedForecastForDeparture, hasCrewPrediction } from "@/lib/marine-forecast";
import type { AutomatedForecast, Shop, Trip } from "../_components/types";

/**
 * **What the trip page may say about the day's weather.** The crew's own read
 * wins over the automated outlook, which is started here and never awaited
 * (`ConditionsLine` streams it in its own `<Suspense>`). With public conditions
 * off on the Features page neither is shown and the outlook is never asked
 * for; the staff conditions panel and the high-wind alert are untouched.
 */
export function publicForecast(
  shop: Pick<Shop, "publicConditionsEnabled">,
  trip: Trip,
): { crewPrediction: boolean; automatedForecast: Promise<AutomatedForecast> } {
  if (!shop.publicConditionsEnabled) {
    return { crewPrediction: false, automatedForecast: Promise.resolve(null) };
  }
  const crewPrediction = hasCrewPrediction(trip);
  return {
    crewPrediction,
    automatedForecast: crewPrediction
      ? Promise.resolve(null)
      : automatedForecastForDeparture(trip.diveSite, trip.startsAt),
  };
}
