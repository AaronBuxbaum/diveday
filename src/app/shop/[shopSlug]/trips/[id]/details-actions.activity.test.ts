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
 * **A departure moved from its own details form is a move** (issue #2313).
 * The schedule builder's move has written "<staffer> moved the departure"
 * since the activity log (D5); the same change made on the trip's details form
 * wrote nothing, so the log missed it depending on which screen was used.
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
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { cancelTripAction, saveDetails } = await import("./details-actions");

const pad = (value: number) => String(value).padStart(2, "0");

/** A live future departure nobody has booked. */
async function emptyFutureTrip(db: AppDb, shopId: string) {
  const [trip] = await db
    .select()
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

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({
      shopId: shop.id,
      shopSlug: shop.slug,
      personId: owner,
      roles: ["owner"],
    }),
  } as never);
  const trip = await emptyFutureTrip(db, shop.id);
  return { db, shop, owner, trip };
}

/** The details form as the page posts it, at a start shifted by `shiftMinutes`. */
function detailsForm(
  trip: Awaited<ReturnType<typeof emptyFutureTrip>>,
  timeZone: string,
  shiftMinutes: number,
): FormData {
  const start = utcToWallTime(new Date(trip.startsAt.getTime() + shiftMinutes * 60_000), timeZone);
  const end = utcToWallTime(new Date(trip.endsAt.getTime() + shiftMinutes * 60_000), timeZone);
  const form = new FormData();
  form.set("title", trip.title);
  form.set("description", trip.description ?? "");
  form.set("meetingPointLabel", trip.meetingPointLabel ?? "");
  form.set("meetingPointAddress", trip.meetingPointAddress ?? "");
  form.set("date", `${start.year}-${pad(start.month)}-${pad(start.day)}`);
  form.set("startTime", `${pad(start.hour)}:${pad(start.minute)}`);
  form.set("endTime", `${pad(end.hour)}:${pad(end.minute)}`);
  form.set("capacity", String(trip.capacity));
  form.set("plannedDives", String(trip.plannedDives));
  if (trip.priceCents !== null) form.set("priceDollars", String(trip.priceCents / 100));
  return form;
}

async function movedLines(db: AppDb, tripId: string) {
  return db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.tripId, tripId), eq(activityEvents.code, "departure_moved")));
}

describe("the details form in the activity log", () => {
  it("preserves the Details tab after its one-shot saved notice is removed", async () => {
    const { shop, trip } = await context();
    const redirect = await redirectedTo(() =>
      saveDetails(shop.slug, trip.id, detailsForm(trip, shop.timezone, 60)),
    );
    const url = new URL(redirect, "https://dive.day");
    expect(url.searchParams.get("notice")).toBe("saved");
    url.searchParams.delete("notice");
    expect(url.searchParams.get("view")).toBe("details");
  });

  it("names the staffer who changed the departure time", async () => {
    const { db, shop, owner, trip } = await context();

    expect(
      await redirectedTo(() =>
        saveDetails(shop.slug, trip.id, detailsForm(trip, shop.timezone, 60)),
      ),
    ).toContain("notice=saved");
    expect(await movedLines(db, trip.id)).toEqual([
      expect.objectContaining({ actorPersonId: owner, shopId: shop.id }),
    ]);
  });

  it("writes no line when the save leaves the time where it was", async () => {
    const { db, shop, trip } = await context();

    expect(
      await redirectedTo(() =>
        saveDetails(shop.slug, trip.id, detailsForm(trip, shop.timezone, 0)),
      ),
    ).toContain("notice=saved");
    expect(await movedLines(db, trip.id)).toEqual([]);
  });
});

describe("Cancel trip on a boat that may be on the water", () => {
  it("refuses a departure that sailed with seats nobody counted, and leaves it scheduled", async () => {
    const { db, shop, trip } = await context();
    const startsAt = new Date(nowDate().getTime() - 2 * 60 * 60 * 1000);
    await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) })
      .where(eq(trips.id, trip.id));

    expect(await redirectedTo(() => cancelTripAction(shop.slug, trip.id))).toContain(
      "notice=cancel-underway",
    );
    const [row] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(row?.status).toBe("scheduled");
  });

  it("cancels a departure still to sail", async () => {
    const { db, shop, trip } = await context();

    expect(await redirectedTo(() => cancelTripAction(shop.slug, trip.id))).toContain(
      "notice=cancelled",
    );
    const [row] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(row?.status).toBe("cancelled");
  });
});
