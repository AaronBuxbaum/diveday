import { and, desc, eq, gt, isNull, notExists } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, tripAssignments, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **"Copy" keeps the crew** (fifth-loop ideas, item 53): the copy panel's
 * "Same crew", ticked by default, puts the source's crew on the copy through
 * `setTripCrew`, and the copy still stands when that write refuses.
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
const { duplicateDepartureAction } = await import("./actions");

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
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

const pad = (value: number) => String(value).padStart(2, "0");

async function crewOf(db: AppDb, tripId: string) {
  const rows = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(eq(tripAssignments.tripId, tripId));
  return rows.map((row) => row.personId).sort();
}

/**
 * Far past the seeded schedule, so the seeded crew rota cannot clash with the
 * copy by accident: only the clash a test sets up can.
 */
const LATER_MS = 200 * 24 * 60 * 60 * 1000;

/** Copy `trip` {@link LATER_MS} on, and return the copy's id and where the action sent us. */
async function copyAWeekOn(
  shop: { id: string; slug: string; timezone: string },
  db: AppDb,
  trip: { id: string; startsAt: Date },
  sameCrew: boolean,
) {
  const [source] = await db.select({ title: trips.title }).from(trips).where(eq(trips.id, trip.id));
  const startsAt = new Date(trip.startsAt.getTime() + LATER_MS);
  const target = utcToWallTime(startsAt, shop.timezone);
  const form = new FormData();
  form.set("tripId", trip.id);
  form.set("date", `${target.year}-${pad(target.month)}-${pad(target.day)}`);
  form.set("startTime", `${pad(target.hour)}:${pad(target.minute)}`);
  if (sameCrew) form.set("sameCrew", "on");
  const to = await redirectedTo(() => duplicateDepartureAction(shop.slug, form));
  const [copy] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shop.id),
        eq(trips.startsAt, startsAt),
        eq(trips.title, source?.title ?? ""),
        isNull(trips.deletedAt),
      ),
    )
    .orderBy(desc(trips.createdAt))
    .limit(1);
  if (!copy) throw new Error("no copy was made");
  return { to, copyId: copy.id, startsAt };
}

describe("copying a departure with its crew", () => {
  it("brings the crew along when Same crew is ticked, and leaves it behind when not", async () => {
    const { db, shop, owner, captain } = await context();
    const trip = await emptyFutureTrip(db, shop.id);
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: captain });
    signIn(shop, owner);

    const kept = await copyAWeekOn(shop, db, trip, true);
    expect(kept.to).toContain("builder=copied");
    expect(kept.to).not.toContain("copied-no-crew");
    expect(await crewOf(db, kept.copyId)).toEqual([captain]);

    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, kept.copyId));
    const bare = await copyAWeekOn(shop, db, trip, false);
    expect(await crewOf(db, bare.copyId)).toEqual([]);
  });

  it("still copies, and says the crew did not come, when one of them is on another boat then", async () => {
    const { db, shop, owner, captain } = await context();
    const trip = await emptyFutureTrip(db, shop.id);
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: captain });
    // The captain already crews a boat at the copy's very hour.
    const weekOn = new Date(trip.startsAt.getTime() + LATER_MS);
    const [busy] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Already crewed",
        startsAt: weekOn,
        endsAt: new Date(weekOn.getTime() + 4 * 60 * 60 * 1000),
        capacity: 6,
      })
      .returning({ id: trips.id });
    if (!busy) throw new Error("trip insert failed");
    await db.insert(tripAssignments).values({ tripId: busy.id, personId: captain });
    signIn(shop, owner);

    const { to, copyId } = await copyAWeekOn(shop, db, trip, true);
    expect(to).toContain("builder=copied-no-crew");
    expect(await crewOf(db, copyId)).toEqual([]);
  });
});
