import type { DiveIntent, DiveIntentCount } from "@/lib/dive-intent";
import { cachedListFormat } from "@/lib/intl-cache";
import type { ReEntryAsk } from "@/lib/re-entry";
import type { DiverMessageKey } from "./messages";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words for the two answers a diver gives on the booking form (ADR
 * 20260904-reef-all-the-way-down, D12/#1172 and D18/#1178). `src/lib` returns
 * codes and this file picks the words, the usual split.
 *
 * **Two vocabularies, kept apart.** A diver picks "Getting comfortable again";
 * the crew reads "2 getting comfortable again". They are the same fact in two
 * voices and neither bundle may borrow the other's phrasing, which is what a
 * shared file of key maps is for.
 *
 * Every key is spelled out rather than built with a template literal, so the
 * message-key type checking stays static — the pattern `fitLabelKey` in
 * `TripDayPlan.tsx` already sets.
 */
export const DIVER_DIVE_INTENT_KEYS: Record<DiveIntent, DiverMessageKey> = {
  easing_back: "booking.intent.easingBack",
  small_life: "booking.intent.smallLife",
  a_wreck: "booking.intent.aWreck",
  skills: "booking.intent.skills",
  good_day: "booking.intent.goodDay",
};

/** The three supports a diver easing back may ask for, as the diver reads them. */
export const DIVER_RE_ENTRY_KEYS: Record<ReEntryAsk, DiverMessageKey> = {
  deck_word: "booking.reEntry.deckWord",
  easy_first_dive: "booking.reEntry.easyFirstDive",
  refresher_course: "booking.reEntry.refresherCourse",
};

/** The same three as a line beside a name on a roster row. Never a warning tone. */
export const STAFF_RE_ENTRY_KEYS: Record<ReEntryAsk, StaffMessageKey> = {
  deck_word: "shared.reEntry.deckWord",
  easy_first_dive: "shared.reEntry.easyFirstDive",
  refresher_course: "shared.reEntry.refresherCourse",
};

/** Each answer as a counted phrase, for the crew's one-line tally. */
const STAFF_DIVE_INTENT_KEYS: Record<DiveIntent, StaffMessageKey> = {
  easing_back: "shared.diveIntent.easingBack",
  small_life: "shared.diveIntent.smallLife",
  a_wreck: "shared.diveIntent.aWreck",
  skills: "shared.diveIntent.skills",
  good_day: "shared.diveIntent.goodDay",
};

/**
 * **The sentence the divemaster reads before a boat leaves** (D23/#1183, folded
 * into D12's count).
 *
 * Counts and nothing else. It names nobody, it suggests no pairing, and a shop
 * that reads it and does nothing has lost nothing — which is the whole of the
 * boundary both issues carry.
 *
 * Returns `null` for an empty tally, so every caller renders nothing at all
 * rather than a heading over an empty line. That is most departures for a long
 * while, and it will stay the ordinary case: the question is optional and
 * nothing nags anybody to answer it.
 */
export function staffDiveIntentLine(
  t: StaffTranslator,
  tally: readonly DiveIntentCount[],
  locale: string,
): string | null {
  if (tally.length === 0) return null;
  const phrases = tally.map(({ intent, count }) => t(STAFF_DIVE_INTENT_KEYS[intent], { count }));
  return t("shared.diveIntent.aboardToday", {
    list: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(phrases),
  });
}
