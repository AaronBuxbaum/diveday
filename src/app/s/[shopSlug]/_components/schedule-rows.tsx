import type { listActiveCourses } from "@/db/courses";
import type { listTripLenses } from "@/db/trip-lenses";
import type { nextSessionStartByCourse } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { tripRequirementMarkers } from "@/i18n/readiness-labels";
import { courseDepthFormat } from "@/i18n/unit-labels";
import {
  courseTotalCents,
  perDiverBookingPriceCents,
  resolveCourseContentDepths,
  resolveImageAlt,
} from "@/lib/courses";
import {
  formatDayParts,
  formatMoneyScanned,
  formatShortDate,
  formatTimeRange,
  formatTimeRangeTz,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { ShopCurrency } from "@/lib/money";
import { publicCoursePath, publicTripPath } from "@/lib/public-routes";
import { courseNextStartLabel } from "../course-date-label";
import type { listedDepartureSummaries } from "./schedule-reads";
import { type RequirementsByTrip, scheduleSeatState, type UpcomingTrips } from "./schedule-view";
import type { WeekLedgerRow } from "./WeekLedger";

/**
 * **One meta line per row.** Where it goes, what it asks of you, and — for a
 * course session — which course it belongs to. Everything the row used to
 * stack beneath its title (the shop's description, the dive-plan words and
 * their two-sentence aside) is on the trip page one tap below.
 * The shop's own word for each departure's kind of day, resolved from the
 * vocabulary already read above rather than joined per row. A departure whose
 * word has since been deleted resolves to null and renders nothing, which is
 * the same silence a departure that never wore one gets.
 */
/**
 * A departure's per-seat price as a schedule row shows it: the booking's own
 * figure, so a course session reads the course total the booking charges and
 * never the trip row's price (fourth UX review item 2, H-125). Null when
 * nothing is priced.
 */
export function seatPriceLabel(
  trip: Parameters<typeof perDiverBookingPriceCents>[0] & {
    course: Parameters<typeof perDiverBookingPriceCents>[1];
  },
  currency: string,
  locale: string,
): string | null {
  const cents = perDiverBookingPriceCents(trip, trip.course);
  return cents !== null ? formatMoneyScanned(cents, currency, locale) : null;
}

export function weekLedgerRows({
  listedTrips,
  lenses,
  diveSitesByTrip,
  requirementsByTrip,
  aboveStatedLevel,
  dayKeyOf,
  shopSlug,
  isEmbed,
  timezone,
  currency,
  locale,
  t,
}: {
  listedTrips: UpcomingTrips;
  lenses: Awaited<ReturnType<typeof listTripLenses>>;
  diveSitesByTrip: Awaited<ReturnType<typeof listedDepartureSummaries>>[0];
  requirementsByTrip: RequirementsByTrip;
  /** The departures that ask for more than the reader said they hold. */
  aboveStatedLevel: Set<string>;
  /** The shop-local calendar day a departure falls on (`scheduleDayWords`). */
  dayKeyOf: (date: Date) => string;
  shopSlug: string;
  isEmbed: boolean;
  timezone: string;
  currency: ShopCurrency;
  locale: string;
  t: DiverTranslator;
}): WeekLedgerRow[] {
  const lensById = new Map(lenses.map((entry) => [entry.id, entry.name]));
  return listedTrips.map((trip) => {
    const diveSites = diveSitesByTrip.get(trip.id) ?? { sites: [], undecidedDives: 0 };
    // The title already naming every site with nothing left to confirm is the
    // title restated, and stays off the row (principle 9).
    const siteLineEarnsItsPlace =
      diveSites.sites.length > 0 &&
      !(
        diveSites.undecidedDives === 0 &&
        diveSites.sites.every((site) => trip.title.toLowerCase().includes(site.name.toLowerCase()))
      );
    // Course sessions are left out for the same reason the trip page leaves
    // them out: a course exists to create the certification, so repeating the
    // site's demand here would read as a bar on the very students it is for.
    const requirement = trip.course ? null : (requirementsByTrip.get(trip.id) ?? null);
    const seats = scheduleSeatState(t, trip);
    return {
      id: trip.id,
      dayKey: dayKeyOf(trip.startsAt),
      dayParts: formatDayParts(trip.startsAt, locale, timezone),
      href: `${publicTripPath(shopSlug, trip.id)}${isEmbed ? "?embed=1" : ""}`,
      linkLabel: t("schedule.tripCardLabel", {
        when: `${formatShortDate(trip.startsAt, locale, timezone)} · ${formatTimeRange(trip.startsAt, trip.endsAt, locale, timezone)}`,
        trip: trip.title,
        capacity: seats.text,
      }),
      timeRange: formatTimeRange(trip.startsAt, trip.endsAt, locale, timezone),
      printDate: formatShortDate(trip.startsAt, locale, timezone),
      printTimeRange: formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, timezone),
      title: trip.title,
      lens: trip.lensId ? (lensById.get(trip.lensId) ?? null) : null,
      course: trip.course
        ? {
            label: t("schedule.courseSession"),
            title: trip.course.title,
            href: publicCoursePath(shopSlug, trip.course.slug),
          }
        : null,
      site: siteLineEarnsItsPlace ? (
        <>
          {cachedListFormat(locale, { type: "conjunction" }).format(
            diveSites.sites.map((site) => site.name),
          )}
          {/* The other half of the count: a two-tank day with one site is a
            published plan ("second tank at the dock"), not a discrepancy —
            but only if it says so. */}
          {diveSites.undecidedDives > 0
            ? ` · ${t("schedule.moreDivesToConfirm", { count: diveSites.undecidedDives })}`
            : null}
        </>
      ) : null,
      requirements: requirement ? tripRequirementMarkers(t, requirement) : [],
      // Marked, never removed, unless the reader asked for the shorter list
      // (issue #696) — and the word is what gives the dimming a name.
      aboveLevel: aboveStatedLevel.has(trip.id) ? t("schedule.filters.aboveLevelChip") : null,
      capacityText: seats.text,
      capacityTone: seats.tone,
      // A course session reads the course total the booking charges, never
      // the trip row's own figure (fourth UX review item 2, H-125).
      price: seatPriceLabel(trip, currency, locale),
    };
  });
}

/**
 * The shelf takes the first three rungs in progression order; "All courses"
 * is the rest. `{depth18}` markers resolve into the shop's own unit before
 * anything reads a field, the same one-shot pass the catalog makes.
 */
export function shelfCourseCards({
  activeCourses,
  shelfNextStarts,
  shop,
  shopSlug,
  currency,
  locale,
  t,
}: {
  activeCourses: Awaited<ReturnType<typeof listActiveCourses>>;
  shelfNextStarts: Awaited<ReturnType<typeof nextSessionStartByCourse>>;
  shop: { depthUnit: Parameters<typeof courseDepthFormat>[1]; timezone: string };
  shopSlug: string;
  currency: ShopCurrency;
  locale: string;
  t: DiverTranslator;
}) {
  const depthFormat = courseDepthFormat(t, shop.depthUnit);
  return activeCourses.slice(0, 3).map((stored) => {
    const course = resolveCourseContentDepths(stored, depthFormat);
    const total = courseTotalCents(course);
    const nextStart = shelfNextStarts.get(course.id) ?? null;
    return {
      duration: course.durationText,
      nextStart: nextStart ? courseNextStartLabel(nextStart, locale, shop.timezone, t) : null,
      id: course.id,
      title: course.title,
      summary: course.summary,
      heroImageUrl: course.heroImageUrl,
      heroImageAlt: resolveImageAlt(
        course.heroImageAlt,
        t("course.photoAltFallback", { course: course.title, n: 1 }),
      ),
      href: publicCoursePath(shopSlug, course.slug),
      price: total !== null ? formatMoneyScanned(total, currency, locale) : null,
    };
  });
}
