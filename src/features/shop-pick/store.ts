import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { shops } from "@/db/schema";
import { pagedUpcomingTripsWithCounts, upcomingSessionsByCourse } from "@/db/trips";
import { getShelfCourse, listActiveCourses } from "@/features/courses";
import { seatsOnSale } from "@/lib/trips";
import { shopDayBounds } from "@/lib/zoned";

/** How many upcoming departures the profile page offers to pick from. */
const PICK_CHOICE_TRIPS = 40;

/** What a shop can feature: one departure or one course. */
export type ShopPick = { kind: "trip" | "course"; id: string };

type PickShop = { id: string; timezone: string };

/** One departure as the board lists it, only while it is still ahead, public and scheduled. */
async function liveTripAhead(db: AppDb, shop: PickShop, tripId: string, now: Date) {
  const { trips } = await pagedUpcomingTripsWithCounts(db, shop.id, {
    tripId,
    now,
    from: shopDayBounds(now, shop.timezone).from,
    publicOnly: true,
    limit: 1,
  });
  const [trip] = trips;
  return trip ? seatsOnSale(trip) : null;
}

/**
 * **What the profile page offers to feature**: the next departures on the public board and every
 * active course, so a pick is always something a diver can actually book.
 */
export async function pickChoices(db: AppDb, shop: PickShop, now: Date) {
  const [{ trips }, activeCourses] = await Promise.all([
    pagedUpcomingTripsWithCounts(db, shop.id, {
      now,
      from: shopDayBounds(now, shop.timezone).from,
      publicOnly: true,
      limit: PICK_CHOICE_TRIPS,
    }),
    listActiveCourses(db, shop.id),
  ]);
  return {
    trips: trips.map((trip) => ({ id: trip.id, title: trip.title, startsAt: trip.startsAt })),
    courses: activeCourses.map((course) => ({ id: course.id, title: course.title })),
  };
}

/**
 * Features one departure or course, or nothing. A pick that is not the shop's own, not public or
 * not ahead is refused (false) and nothing changes, so a stale form cannot feature a boat that
 * has sailed or one that belongs to another shop.
 */
export async function setShopPick(
  db: AppDb,
  shop: PickShop,
  pick: ShopPick | null,
  now: Date,
): Promise<boolean> {
  if (pick?.kind === "trip" && !(await liveTripAhead(db, shop, pick.id, now))) return false;
  if (pick?.kind === "course" && !(await getShelfCourse(db, shop.id, pick.id))) return false;
  await db
    .update(shops)
    .set({
      pickTripId: pick?.kind === "trip" ? pick.id : null,
      pickCourseId: pick?.kind === "course" ? pick.id : null,
    })
    .where(eq(shops.id, shop.id));
  return true;
}

/**
 * **The pick as the storefront draws it**, or null when the shop has none or it has lapsed: a
 * departure that sailed, went private or was deleted, or a course switched off, just stops
 * showing.
 */
export async function readShopPick(
  db: AppDb,
  shop: PickShop & { pickTripId: string | null; pickCourseId: string | null },
  now: Date,
) {
  if (shop.pickTripId) {
    const trip = await liveTripAhead(db, shop, shop.pickTripId, now);
    return trip ? ({ kind: "trip", trip } as const) : null;
  }
  if (shop.pickCourseId) {
    const course = await getShelfCourse(db, shop.id, shop.pickCourseId);
    if (!course) return null;
    const starts = await upcomingSessionsByCourse(db, shop.id, [course.id], now);
    return { kind: "course", course, starts: starts.get(course.id) ?? [] } as const;
  }
  return null;
}
