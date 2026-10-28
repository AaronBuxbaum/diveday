import { and, eq, gt, isNull, notExists } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createBoat } from "@/db/boats";
import type { AppDb } from "@/db/client";
import { activityEvents, boats, bookings, trips } from "@/db/schema";
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
const { cancelTripAction, saveDetails, saveDetailsSection } = await import("./details-actions");

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

  it("refuses a fifth planned dive on an ordinary departure without changing it", async () => {
    const { db, shop, trip } = await context();
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("plannedDives", "5");
    expect(await redirectedTo(() => saveDetails(shop.slug, trip.id, form))).toContain(
      "notice=invalid",
    );
    const [unchanged] = await db
      .select({ plannedDives: trips.plannedDives })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(unchanged?.plannedDives).toBe(trip.plannedDives);
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

describe("saving details after changing the assigned boat", () => {
  async function onCertifiedBoat() {
    const result = await context();
    const boat = await createBoat(result.db, result.shop.id, "Six seats", 6);
    await result.db.update(boats).set({ certifiedPassengers: 6 }).where(eq(boats.id, boat.id));
    await result.db
      .update(trips)
      .set({ boatId: boat.id, diveMode: "boat", capacity: 6 })
      .where(eq(trips.id, result.trip.id));
    return { ...result, boat };
  }

  it("clears a selected boat before checking its certificate", async () => {
    const { db, shop, trip } = await onCertifiedBoat();
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("diveMode", "boat");
    form.set("boatId", "");
    form.set("capacity", "8");
    expect(await redirectedTo(() => saveDetails(shop.slug, trip.id, form))).toContain(
      "notice=saved",
    );
    const [saved] = await db
      .select({ boatId: trips.boatId, capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(saved).toEqual({ boatId: null, capacity: 8 });
  });

  it("keeps and checks the existing boat when the form omits its selector", async () => {
    const { db, shop, trip, boat } = await onCertifiedBoat();
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("capacity", "8");
    expect(await redirectedTo(() => saveDetails(shop.slug, trip.id, form))).toContain(
      "notice=capacity-above-certificate",
    );
    const [saved] = await db
      .select({ boatId: trips.boatId, capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(saved).toEqual({ boatId: boat.id, capacity: 6 });
  });

  it("keeps the existing boat when only the mode is submitted", async () => {
    const { db, shop, trip, boat } = await onCertifiedBoat();
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("diveMode", "boat");
    form.set("capacity", "6");
    expect(await redirectedTo(() => saveDetails(shop.slug, trip.id, form))).toContain(
      "notice=saved",
    );
    const [saved] = await db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(saved?.boatId).toBe(boat.id);
  });

  it("saves the chosen boat when the shop has only one dive mode", async () => {
    const { db, shop, trip } = await onCertifiedBoat();
    const replacement = await createBoat(db, shop.id, "Twelve seats", 12);
    await db.update(boats).set({ certifiedPassengers: 12 }).where(eq(boats.id, replacement.id));
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("boatId", replacement.id);
    form.set("capacity", "8");
    expect(await redirectedTo(() => saveDetails(shop.slug, trip.id, form))).toContain(
      "notice=saved",
    );
    const [saved] = await db
      .select({ boatId: trips.boatId, capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(saved).toEqual({ boatId: replacement.id, capacity: 8 });
  });

  it("refuses against the selected boat’s certificate and keeps the old boat", async () => {
    const { db, shop, trip, boat } = await onCertifiedBoat();
    const smaller = await createBoat(db, shop.id, "Four seats", 4);
    await db.update(boats).set({ certifiedPassengers: 4 }).where(eq(boats.id, smaller.id));
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("boatId", smaller.id);
    form.set("capacity", "8");
    const redirect = await redirectedTo(() => saveDetails(shop.slug, trip.id, form));
    expect(redirect).toContain("notice=capacity-above-certificate");
    expect(redirect).toContain("count=4");
    const [saved] = await db
      .select({ boatId: trips.boatId, capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(saved).toEqual({ boatId: boat.id, capacity: 6 });
  });

  it("clears the boat when the shop has only one dive mode", async () => {
    const { db, shop, trip } = await onCertifiedBoat();
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("boatId", "");
    form.set("capacity", "8");
    expect(await redirectedTo(() => saveDetails(shop.slug, trip.id, form))).toContain(
      "notice=saved",
    );
    const [saved] = await db
      .select({ boatId: trips.boatId, capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(saved).toEqual({ boatId: null, capacity: 8 });
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

describe("scoped departure saves (issue 3141)", () => {
  it("changes the meeting point without rewriting the plan, money or schedule", async () => {
    const { db, shop, trip } = await context();
    const form = new FormData();
    form.set("meetingPointLabel", "North jetty");
    form.set("meetingPointAddress", "12 Dock Road");
    form.set("title", "Forged title");
    form.set("priceDollars", "1");
    form.set("plannedDives", "4");
    const location = await redirectedTo(() =>
      saveDetailsSection(shop.slug, trip.id, "meeting", form),
    );
    const url = new URL(location, "https://dive.day");
    expect(url.searchParams.get("notice")).toBe("saved");
    expect(url.searchParams.get("form")).toBe("meeting");
    const [after] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(after).toMatchObject({
      title: trip.title,
      description: trip.description,
      priceCents: trip.priceCents,
      depositCents: trip.depositCents,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      diveSiteId: trip.diveSiteId,
      meetingPointLabel: "North jetty",
      meetingPointAddress: "12 Dock Road",
    });
    expect(await movedLines(db, trip.id)).toEqual([]);
  });

  it("retimes through Timing, retains commercial and arrival facts, and records the move", async () => {
    const { db, shop, trip } = await context();
    const form = detailsForm(trip, shop.timezone, 60);
    form.set("priceDollars", "1");
    const location = await redirectedTo(() =>
      saveDetailsSection(shop.slug, trip.id, "timing", form),
    );
    expect(new URL(location, "https://dive.day").searchParams.get("form")).toBe("timing");
    const [after] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(after.startsAt.getTime()).toBe(trip.startsAt.getTime() + 60 * 60_000);
    expect(after).toMatchObject({
      title: trip.title,
      priceCents: trip.priceCents,
      depositCents: trip.depositCents,
      meetingPointLabel: trip.meetingPointLabel,
      meetingPointAddress: trip.meetingPointAddress,
      plannedDives: trip.plannedDives,
    });
    expect(await movedLines(db, trip.id)).toHaveLength(1);
  });

  it("keeps a Timing refusal beside Timing and writes nothing", async () => {
    const { db, shop, trip } = await context();
    const form = detailsForm(trip, shop.timezone, 0);
    form.set("endTime", form.get("startTime") ?? "");
    const location = await redirectedTo(() =>
      saveDetailsSection(shop.slug, trip.id, "timing", form),
    );
    const url = new URL(location, "https://dive.day");
    expect(url.searchParams.get("notice")).toBe("end-before-start");
    expect(url.searchParams.get("form")).toBe("timing");
    const [after] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(after).toEqual(trip);
  });
});

it("an authenticated forged section name cannot write departure facts", async () => {
  const { db, shop, trip } = await context();
  const form = detailsForm(trip, shop.timezone, 60);
  form.set("title", "Forged replacement");
  const location = await redirectedTo(() =>
    saveDetailsSection(shop.slug, trip.id, "__proto__" as never, form),
  );
  expect(new URL(location, "https://dive.day").searchParams.get("notice")).toBe("invalid");
  const [after] = await db.select().from(trips).where(eq(trips.id, trip.id));
  expect(after).toEqual(trip);
});
