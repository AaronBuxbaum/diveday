import { fieldGuideCards } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { readTripPage } from "./page-reads";

type TripPage = Awaited<ReturnType<typeof readTripPage>>;

/**
 * Each of the day's dives with what the shop says lives at its site (the
 * field-guide cards, in the reader's words) and the moments divers saved
 * there. A dive with no site carries neither. What `TripDayPlan` and
 * `TripPitch` both read, and `dayCoverPhoto` picks the day's photo from.
 */
export function dayBriefings(
  tripDives: TripPage["tripDives"],
  extras: TripPage["briefing"]["extras"],
  t: DiverTranslator,
) {
  return tripDives.map(({ dive, diveSite }) => ({
    dive,
    diveSite,
    creatures: fieldGuideCards(diveSite ? (extras.creatures.get(diveSite.id) ?? []) : [], t),
    moments: diveSite ? (extras.moments.get(diveSite.id) ?? []) : [],
  }));
}
