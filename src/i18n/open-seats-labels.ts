import { cachedListFormat } from "@/lib/intl-cache";
import type { OpenSeatsDebrief } from "@/lib/open-seats";
import type { StaffTranslator } from "./staff-messages";

/**
 * **The open-seats debrief, as one sentence** (issue #1207, D47).
 *
 * One to three clauses joined by the locale's own conjunction, wrapped in the
 * sentence that leads with the count. `cachedListFormat` rather than a bare
 * `new Intl.ListFormat`: a formatter costs about twelve times what reusing one
 * does, and the Details tab formats on every sailed departure
 * (Biome's `intlCache` rule).
 *
 * Null when there is no clause to make, which is the ADR's standing rule that
 * a widening renders nothing when it is not true. `openSeatsDebrief` has
 * already refused a departure that filled and one that never sailed, so
 * anything arriving here has seats to explain.
 */
export function openSeatsDebriefText(
  t: StaffTranslator,
  locale: string,
  debrief: OpenSeatsDebrief,
  input: { comparableDate: string },
): string | null {
  const clauses: string[] = [];
  if (debrief.lastBookingDaysOut !== null) {
    clauses.push(t("trips.openSeats.lastBooking", { days: debrief.lastBookingDaysOut }));
  }
  // Only the *absent* deal is a clause. A deal that went out is the shop having
  // already done the thing, which needs no sentence about it.
  if (!debrief.dealSent) clauses.push(t("trips.openSeats.noDeal"));
  if (debrief.comparable) {
    clauses.push(
      t(
        debrief.comparable.samePrice
          ? "trips.openSeats.comparableSamePrice"
          : "trips.openSeats.comparableOtherPrice",
        { title: debrief.comparable.title, date: input.comparableDate },
      ),
    );
  }
  if (clauses.length === 0) return null;
  return t("trips.openSeats.sentence", {
    seats: debrief.openSeats,
    facts: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(clauses),
  });
}
