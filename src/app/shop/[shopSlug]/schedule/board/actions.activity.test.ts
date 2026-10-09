import { and, eq, gt, isNull, notExists } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { activityEvents, bookings, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **Who changed the board** (D5). The schedule builder's acts wrote no actor
 * anywhere until the shop's activity log asked "who moved this departure?";
 * each now leaves one line on the departure it changed, naming the staffer —
 * and a refused act leaves none.
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
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { moveDepartureAction, removeDepartureAction } = await import("./actions");

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
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

describe("the board's acts in the activity log", () => {
  it("names the staffer who moved a departure", async () => {
    const { db, shop, owner } = await context();
    const trip = await emptyFutureTrip(db, shop.id);
    const target = utcToWallTime(
      new Date(trip.startsAt.getTime() + 24 * 60 * 60 * 1000),
      shop.timezone,
    );
    const form = new FormData();
    form.set("tripId", trip.id);
    form.set("date", `${target.year}-${pad(target.month)}-${pad(target.day)}`);
    form.set("startTime", `${pad(target.hour)}:${pad(target.minute)}`);
    signIn(shop, owner);

    expect(await redirectedTo(() => moveDepartureAction(shop.slug, form))).toContain(
      "builder=moved",
    );
    expect(await linesOn(db, trip.id, "departure_moved")).toEqual([
      expect.objectContaining({ actorPersonId: owner, shopId: shop.id }),
    ]);
  });

  it("names the staffer who deleted one, on the departure they deleted", async () => {
    const { db, shop, owner } = await context();
    const trip = await emptyFutureTrip(db, shop.id);
    const form = new FormData();
    form.set("tripId", trip.id);
    signIn(shop, owner);

    expect(await redirectedTo(() => removeDepartureAction(shop.slug, form))).toContain(
      "builder=removed",
    );
    expect(await linesOn(db, trip.id, "departure_deleted")).toEqual([
      expect.objectContaining({ actorPersonId: owner }),
    ]);
  });

  it("writes nothing for an act the builder refused", async () => {
    const { db, shop, captain } = await context();
    const trip = await emptyFutureTrip(db, shop.id);
    const form = new FormData();
    form.set("tripId", trip.id);
    // A captain does not define the board (`canConfigureTrips`).
    signIn(shop, captain);

    expect(await redirectedTo(() => removeDepartureAction(shop.slug, form))).toContain(
      "builder=not-authorized",
    );
    expect(await linesOn(db, trip.id, "departure_deleted")).toEqual([]);
  });
});
