import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CoursePricing, perDiverBookingPriceCents } from "@/lib/courses";
import { formatMoneyScanned, formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";

/**
 * The trip header's price: the scanned form and the editor's own unit, as the
 * board and the public hero print it, "$95 per diver" (third review, item 7).
 * Nothing for a departure with no price set.
 *
 * **A course session quotes what the diver is charged** (fourth UX review,
 * item 26; H-20261014-no-mid-thread-model's staff side): the course fee plus its eLearning fee, the
 * figure the public page and checkout read through the same
 * `perDiverBookingPriceCents`, never the departure's own price, which a
 * priced course overrides. Staff quote this figure to students on the phone.
 */
export function tripHeaderPrice(
  trip: { priceCents: number | null; course: CoursePricing | null },
  currency: string,
  locale: string,
  t: StaffTranslator,
): string | undefined {
  const priceCents = perDiverBookingPriceCents(trip, trip.course);
  if (priceCents === null) return undefined;
  return `${formatMoneyScanned(priceCents, toShopCurrency(currency), locale)} ${t("trips.about.perDiver")}`;
}

/**
 * **"3 days · Fri, Oct 23 – Sun, Oct 25"** for a departure that meets on more
 * than one day (fourth UX review, item 26), the span the public page states;
 * the header's single date and hours read as a one-day course. Undefined for
 * a one-day departure, which keeps its date and time.
 */
export function tripHeaderDaySpan(
  days: readonly { startsAt: Date }[],
  locale: string,
  timeZone: string,
  t: StaffTranslator,
): string | undefined {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last || days.length < 2) return undefined;
  return t("trips.about.meetingDaysSummary", {
    count: days.length,
    first: formatShortDate(first.startsAt, locale, timeZone),
    last: formatShortDate(last.startsAt, locale, timeZone),
  });
}
