import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import { conditionReadings } from "@/i18n/condition-labels";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { DepthUnit } from "@/lib/depth-units";
import { type CrewPrediction, hasCrewPrediction } from "@/lib/marine-forecast";
import type { SiteSightings } from "@/lib/sightings";
import { type TemperatureUnit, temperatureUnitFor } from "@/lib/temperature-units";

/**
 * One earned fact: a near departure’s crew reading, otherwise an eligible
 * recent sighting.
 *
 * `shown` counts the sighting sentences the rows above already carry (#4932).
 * The same sentence down a list stops reading as news about a boat, so a row
 * takes the site’s first species no row above used; with none left it repeats
 * a sentence once and then says nothing, never inventing a fact.
 */
export function scheduleRowFact(
  trip: CrewPrediction & { startsAt: Date },
  seen: SiteSightings | undefined,
  {
    now,
    shop,
    t,
    shown,
  }: {
    now: Date;
    shown?: Map<string, number>;
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
  const sentences: string[] = [];
  for (const tally of seen?.species ?? []) {
    const name =
      tally.customName ??
      (isMarineLifeSlug(tally.speciesSlug) ? marineLifeCard(tally.speciesSlug, t).plural : null);
    if (name) sentences.push(t("schedule.recentSighting", { species: name }));
  }
  if (!shown) return sentences[0] ?? null;
  const used = (sentence: string) => shown.get(sentence) ?? 0;
  const chosen =
    sentences.find((sentence) => used(sentence) === 0) ??
    sentences.find((sentence) => used(sentence) === 1);
  if (!chosen) return null;
  shown.set(chosen, used(chosen) + 1);
  return chosen;
}
