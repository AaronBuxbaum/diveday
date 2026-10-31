import { listBoats } from "@/db/boats";
import type { AppDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { tripRequirementSummaries } from "@/db/readiness";
import { getShopReviewAggregate } from "@/db/reviews";
import { listTripLenses } from "@/db/trip-lenses";
import {
  countShopTrips,
  nextSessionStartByCourse,
  pagedUpcomingTripsWithCounts,
  tripDiveSiteSummaries,
  upcomingScheduleRange,
} from "@/db/trips";
import { EMPTY_REVIEW_AGGREGATE } from "@/lib/reviews";
import { resolveLens } from "@/lib/trip-lenses";
import { seatsOnSale } from "@/lib/trips";

/**
 * **Has this shop ever run a departure** — which is not what `hasUpcoming` asks.
 *
 * `upcomingScheduleRange` is scheduled, public, and ahead of now, so it goes false for a shop
 * between seasons with three hundred departures behind it, and for one whose whole board is
 * currently private. The deal list stands down on that signal, and standing it down for those two
 * shops is backwards: an off-season visitor is exactly the person worth telling when a boat needs
 * to fill seats at a discount. The count only runs in the rare case the cheap signal already says
 * no.
 */
export async function everHadDepartureRead(
  db: AppDb,
  shopId: string,
  hasUpcoming: boolean,
): Promise<boolean> {
  return hasUpcoming || (await countShopTrips(db, shopId)) > 0;
}

/** What the schedule's cards say about each listed departure, one read each for the page. */
export function listedDepartureSummaries(db: AppDb, shopId: string, tripIds: string[]) {
  return Promise.all([
    // Where each departure actually goes, read off the *dives* rather than `trips.dive_site_id`
    // (dive one's site, copied onto the trip row), so a two-site day names both and a day whose
    // open tank is the first one still names the site it visits.
    tripDiveSiteSummaries(db, shopId, tripIds),
    // What each departure asks of anybody — the trip's own gate folded with every site it visits.
    // A property of the *trip*, so it is safe on an anonymous page: it says nothing about any
    // reader, and the map holds only the departures that demand something (issue #695).
    tripRequirementSummaries(db, shopId, tripIds),
  ]);
}

/**
 * **The schedule page's one batch of reads**, its dependents chained inside it
 * (code review 2026-10-10, item 24). The frame (`isEmbed`) reads no lenses,
 * courses, fleet or review aggregate: it renders none of them.
 */
export async function readSchedulePage(
  db: AppDb,
  shop: { id: string; reviewsEnabled: boolean },
  {
    isEmbed,
    lens,
    cursor,
    now,
    listMonthBounds,
    hasSpaceFilter,
    tripTypeFilter,
  }: {
    isEmbed: boolean;
    /** The raw `?lens=`; resolved against the shop's own words here. */
    lens: string | undefined;
    /** The keyset cursor: `?after=` reads on from a departure, `?before=` reads back from one. */
    cursor: { after: string | undefined; before: string | undefined };
    now: Date;
    /** The explicit month's bounds when the diver paged the rail to one. */
    listMonthBounds: { monthStart: Date; monthEnd: Date } | null;
    hasSpaceFilter: boolean;
    tripTypeFilter: "fun_dive" | "course" | undefined;
  },
) {
  /**
   * **The shop's trip tags** — ADR 20260904-reef-all-the-way-down, decision 2 (issue #1162).
   *
   * Read inside the batch below, and the list query waits on it only when the URL names a lens: the
   * narrowing happens in SQL inside `upcomingTripScope`, so the keyset pages stay honest, and it
   * needs the resolved lens id. With no `?lens=` (every first visit) the list starts beside it.
   * Never in the frame — `FilterChips` renders a `<nav>` landmark and `?embed=1` promises the host
   * page zero navigation landmarks.
   *
   * An unknown or malformed `?lens=` resolves to null and renders the whole board with "Every
   * departure" current, which is what a link shared before the shop deleted a word should do.
   */
  const lensesRead = isEmbed ? Promise.resolve([]) : listTripLenses(db, shop.id);
  const activeLensRead = lens
    ? lensesRead.then((rows) => resolveLens(lens, rows))
    : Promise.resolve(null);

  // The published-review *list* still streams in separately (below, via <ScheduleReviewsSection>) —
  // it is the slower, independent read the shell and trip list never needed to wait behind (docs
  // task 119 follow-up: streaming the schedule).
  //
  // The **aggregate** joined this batch when the shopfront landed: it is one row, and it is now
  // part of the identity band at the very top of the page (ADR
  // 20260827-clearwater-surface-language, decision 8), where streaming it separately would either
  // pop a rating line in under the shop's name or cost a reserved gap on every shop that has no
  // reviews at all. It is handed down to the reviews section rather than read twice.
  //
  // Both, and the courses shelf, stand down inside the frame: `?embed=1` renders neither the hero
  // nor the shelves.
  //
  // **One batch, its dependents chained inside it** (code review 2026-10-10, item 24).
  const upcomingRead = activeLensRead.then((activeLens) =>
    pagedUpcomingTripsWithCounts(db, shop.id, {
      cursor: cursor.after,
      before: cursor.before,
      now,
      ...listMonthBounds,
      hasSpace: hasSpaceFilter ? true : undefined,
      tripType: tripTypeFilter,
      publicOnly: true,
      lensId: activeLens?.id,
    }).then((page) => ({ ...page, trips: page.trips.map(seatsOnSale) })),
  );
  const rangeRead = upcomingScheduleRange(db, shop.id, now, { publicOnly: true });
  const activeCoursesRead = isEmbed ? Promise.resolve([]) : listActiveCourses(db, shop.id);
  const shelfIds = activeCoursesRead.then((shelf) => shelf.slice(0, 3).map((course) => course.id));
  const [
    lenses,
    activeLens,
    range,
    { trips: upcoming, nextCursor, prevCursor },
    reviewAggregate,
    activeCourses,
    boats,
    everHadDeparture,
    [diveSitesByTrip, requirementsByTrip],
    shelfNextStarts,
  ] = await Promise.all([
    lensesRead,
    activeLensRead,
    rangeRead,
    upcomingRead,
    // A shop that switched reviews off shows no stars anywhere, not an empty rating (ADR
    // 20261005-optional-shop-features).
    isEmbed || !shop.reviewsEnabled ? EMPTY_REVIEW_AGGREGATE : getShopReviewAggregate(db, shop.id),
    activeCoursesRead,
    // The fleet, for the storefront's boats section (Harbor). Not in the widget: an embed is the
    // list-first window and names no hulls.
    isEmbed ? [] : listBoats(db, shop.id),
    rangeRead.then((scheduled) => everHadDepartureRead(db, shop.id, scheduled.first !== null)),
    upcomingRead.then(({ trips: listed }) =>
      listedDepartureSummaries(
        db,
        shop.id,
        listed.map((trip) => trip.id),
      ),
    ),
    // The shelf's next starts: a diver reads it, so only storefront sessions count.
    shelfIds.then((ids) => nextSessionStartByCourse(db, shop.id, ids, "storefront")),
  ]);
  return {
    lenses,
    activeLens,
    range,
    upcoming,
    cursors: { nextCursor, prevCursor },
    reviewAggregate,
    activeCourses,
    boats,
    everHadDeparture,
    diveSitesByTrip,
    requirementsByTrip,
    shelfNextStarts,
  };
}
