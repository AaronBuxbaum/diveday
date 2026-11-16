import { and, eq, gt, isNull, notExists } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { activityEvents, bookings, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * A Move submitted for the time the departure already holds (a double tap, or
 * the panel saved untouched) changes nothing, so it writes no "moved" line.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// The real gate, behind a mocked `auth()`: `requireShopSurface` re-reads the
// staffer's live roles from the seeded database, as it does in production.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { moveDepartureAction } = await import("./actions");

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(auth).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }) as never,
  );
}

/** A live future departure nobody has booked: free to move or delete. */
async function emptyFutureTrip(db: AppDb, shopId: string) {
  const [trip] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        isNull(trips.deletedAt),
        isNull(trips.courseId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, new Date(nowDate().getTime() + 2 * 24 * 60 * 60 * 1000)),
        notExists(
          db.select({ id: bookings.id }).from(bookings).where(eq(bookings.tripId, trips.id)),
        ),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!trip) throw new Error("seeded shop has no empty future departure");
  return trip;
}

async function linesOn(db: AppDb, tripId: string, code: string) {
  return db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.tripId, tripId), eq(activityEvents.code, code)));
}

const pad = (value: number) => String(value).padStart(2, "0");

describe("moving a departure to the time it already holds", () => {
  it("writes no second activity line", async () => {
    const { db, shop, owner } = await context();
    const trip = await emptyFutureTrip(db, shop.id);
    const target = utcToWallTime(
      new Date(trip.startsAt.getTime() + 24 * 60 * 60 * 1000),
      shop.timezone,
    );
    const form = () => {
      const data = new FormData();
      data.set("tripId", trip.id);
      data.set("date", `${target.year}-${pad(target.month)}-${pad(target.day)}`);
      data.set("startTime", `${pad(target.hour)}:${pad(target.minute)}`);
      return data;
    };
    signIn(shop, owner);

    expect(await redirectedTo(() => moveDepartureAction(shop.slug, form()))).toContain(
      "builder=moved",
    );
    expect(await redirectedTo(() => moveDepartureAction(shop.slug, form()))).toContain(
      "builder=moved",
    );
    expect(await linesOn(db, trip.id, "departure_moved")).toHaveLength(1);
  });
});
