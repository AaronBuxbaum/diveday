// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { shopFirstBooking } from "./first-booking";
import { bookings, people, priorVisits, shops, trips } from "./schema";
import { createTrip } from "./trips";

/**
 * **The shop's first booking ever, while it is still the only one** — the
 * coral moment ADR 20260827-first-light, decision 6 puts on the day spine, and
 * the once-ever row of ADR 20260827-clearwater-surface-language's coral budget.
 *
 * Every case here is a *transition*: what turns the moment on, and each of the
 * four things that turn it off forever. Nothing is stored, so nothing here
 * writes a flag — the reader is the whole rule.
 */
const NOW = new Date("2026-09-01T14:00:00.000Z");

async function freshShop(slug: string) {
  const db = await seededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shop ${slug}`, slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("test shop insert failed");
  return { db, shopId: shop.id };
}

async function aDeparture(db: AppDb, shopId: string, startsAt: Date, title = "Two-Tank Reef") {
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 8,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip insert failed");
  return trip;
}

async function aSeat(
  db: AppDb,
  shopId: string,
  tripId: string,
  fullName: string,
  status: "booked" | "cancelled" = "booked",
) {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("test person insert failed");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId, tripId, personId: person.id, status })
    .returning();
  if (!booking) throw new Error("test booking insert failed");
  return booking;
}

describe("shopFirstBooking", () => {
  it("says nothing for a shop nobody has booked", async () => {
    const { db, shopId } = await freshShop("first-booking-none");
    await aDeparture(db, shopId, new Date("2026-09-05T12:30:00.000Z"));
    expect(await shopFirstBooking(db, shopId, NOW)).toBeNull();
  });

  it("names the diver and the departure on the shop's very first seat", async () => {
    const { db, shopId } = await freshShop("first-booking-one");
    const trip = await aDeparture(
      db,
      shopId,
      new Date("2026-09-05T12:30:00.000Z"),
      "Two-Tank — Alligator Reef",
    );
    await aSeat(db, shopId, trip.id, "Ravi Chandra");

    const mark = await shopFirstBooking(db, shopId, NOW);
    expect(mark).toMatchObject({
      tripId: trip.id,
      tripTitle: "Two-Tank — Alligator Reef",
      diverName: "Ravi Chandra",
    });
  });

  it("ends forever at the second booking, whichever departure it is on", async () => {
    const { db, shopId } = await freshShop("first-booking-two");
    const trip = await aDeparture(db, shopId, new Date("2026-09-05T12:30:00.000Z"));
    await aSeat(db, shopId, trip.id, "Ravi Chandra");
    await aSeat(db, shopId, trip.id, "Noor Rahman");
    expect(await shopFirstBooking(db, shopId, NOW)).toBeNull();
  });

  it("counts a cancelled booking against the history but never celebrates one", async () => {
    // **Why the count is over every row rather than the live ones.** A shop on
    // its second diver after one cancellation has exactly one *live* booking
    // and nothing to celebrate — and its own first booking, cancelled, is not
    // a moment either.
    const { db, shopId } = await freshShop("first-booking-cancelled");
    const trip = await aDeparture(db, shopId, new Date("2026-09-05T12:30:00.000Z"));
    await aSeat(db, shopId, trip.id, "Ravi Chandra", "cancelled");
    expect(await shopFirstBooking(db, shopId, NOW)).toBeNull();

    await aSeat(db, shopId, trip.id, "Noor Rahman");
    expect(await shopFirstBooking(db, shopId, NOW)).toBeNull();
  });

  it("holds through the late-arrival buffer, then lets the boat take the moment with it", async () => {
    const { db, shopId } = await freshShop("first-booking-sailed");
    // Fifty minutes ago: inside the standing one-hour buffer every "has it
    // sailed" question in this app carries, so the boat has not gone yet.
    const trip = await aDeparture(db, shopId, new Date(NOW.getTime() - 50 * 60 * 1000));
    await aSeat(db, shopId, trip.id, "Ravi Chandra");
    expect(await shopFirstBooking(db, shopId, NOW)).not.toBeNull();

    const later = new Date(NOW.getTime() + 20 * 60 * 1000);
    expect(await shopFirstBooking(db, shopId, later)).toBeNull();
  });

  it("goes with a departure the shop took off the board", async () => {
    const { db, shopId } = await freshShop("first-booking-deleted-trip");
    const trip = await aDeparture(db, shopId, new Date("2026-09-05T12:30:00.000Z"));
    await aSeat(db, shopId, trip.id, "Ravi Chandra");
    await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, trip.id));
    expect(await shopFirstBooking(db, shopId, NOW)).toBeNull();
  });

  it("still fires for a shop that imported ten years of history last week", async () => {
    // **The false-fire that would have been embarrassing.** Prior visits live
    // in `prior_visits`, not `bookings` — a shop that migrated its roster on
    // Monday and takes its first DiveDay booking on Tuesday is still having
    // its first booking *here*, and the reader must not confuse "we have a
    // history" with "we have taken a seat".
    const { db, shopId } = await freshShop("first-booking-imported");
    const trip = await aDeparture(db, shopId, new Date("2026-09-05T12:30:00.000Z"));
    const booking = await aSeat(db, shopId, trip.id, "Ravi Chandra");
    const [imported] = await db
      .insert(people)
      .values({ shopId, fullName: "Yara Halabi" })
      .returning();
    if (!imported) throw new Error("test person insert failed");
    await db.insert(priorVisits).values({
      shopId,
      personId: imported.id,
      visitedOn: "2019-06-14",
      title: "Two-tank Molasses Reef",
      dedupeKey: "legacy-1",
      importedAt: NOW,
    });

    const mark = await shopFirstBooking(db, shopId, NOW);
    expect(mark?.bookingId).toBe(booking.id);
  });

  it("is not fooled by another shop's bookings", async () => {
    // The seeded demo shop shares this database and has a boardful.
    const { db, shopId } = await freshShop("first-booking-tenant");
    const trip = await aDeparture(db, shopId, new Date("2026-09-05T12:30:00.000Z"));
    await aSeat(db, shopId, trip.id, "Ravi Chandra");
    expect(await shopFirstBooking(db, shopId, NOW)).not.toBeNull();
  });
});
