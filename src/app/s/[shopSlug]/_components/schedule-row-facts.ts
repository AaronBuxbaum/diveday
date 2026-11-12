import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import { conditionReadings } from "@/i18n/condition-labels";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { DepthUnit } from "@/lib/depth-units";
import { type CrewPrediction, hasCrewPrediction } from "@/lib/marine-forecast";
import type { SiteSightings } from "@/lib/sightings";
import { type TemperatureUnit, temperatureUnitFor } from "@/lib/temperature-units";

/** One earned fact: a near departure’s crew reading, otherwise the first eligible recent sighting. */
export function scheduleRowFact(
  trip: CrewPrediction & { startsAt: Date },
  seen: SiteSightings | undefined,
  {
    now,
    shop,
    t,
  }: {
    now: Date;
    shop: { depthUnit: DepthUnit; temperatureUnit?: TemperatureUnit | null };
    t: DiverTranslator;
  },
): string | null {
  const until = trip.startsAt.getTime() - now.getTime();
  if (until >= 0 && until <= 48 * 60 * 60 * 1000 && hasCrewPrediction(trip)) {
    const readings = conditionReadings(
      t,
      { ...trip, surfaceText: trip.surfaceConditions },
      { depth: shop.depthUnit, temperature: temperatureUnitFor(shop) },
    );
    return readings.join(" · ") || trip.conditionsSummary;
  }
  for (const tally of seen?.species ?? []) {
    const name =
      tally.customName ??
      (isMarineLifeSlug(tally.speciesSlug) ? marineLifeCard(tally.speciesSlug, t).name : null);
    if (name)
      return t("schedule.recentSighting", {
        species: name,
        seen: tally.dives,
        dives: seen?.dives ?? 0,
      });
  }
  return null;
}
