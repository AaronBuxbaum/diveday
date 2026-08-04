import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { closeDay, getDayCloseout } from "./closeout";
import { bookings as bookingsTable, people, rollCallEvents, trips as tripsTable } from "./schema";
import { listStaff } from "./trips";

const HOUR = 60 * 60 * 1000;

describe("day close-out (in-memory PGlite)", () => {
  it("assembles today's state and records the act with what was outstanding", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");

    const before = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(before.latest).toBeNull();
    expect(before.closeCount).toBe(0);
    // The seed always has a boat sailing today (demoTodayDepartureStart).
    expect(before.state.departures.length).toBeGreaterThan(0);

    const record = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: {},
    });
    expect(record.actorName).toBe(staff.person.fullName);
    expect(record.shopDay).toBe(before.state.shopDay);

    const after = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(after.closeCount).toBe(1);
    expect(after.latest?.id).toBe(record.id);
    expect(after.latest?.actorName).toBe(staff.person.fullName);
  });

  it("records exactly the unreconciled head count that was open at the moment of closing", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");

    // A boat that sailed this morning and tied up two hours ago, with one
    // diver counted aboard at the dock and never counted back after dive one
    // — the day-with-an-unreconciled-roll-call shape.
    const endsAt = new Date(nowMs() - 2 * HOUR);
    const [trip] = await db
      .insert(tripsTable)
      .values({
        shopId: shop.id,
        title: "Returned Two-Tank — Molasses",
        startsAt: new Date(endsAt.getTime() - 4 * HOUR),
        endsAt,
        capacity: 12,
        plannedDives: 1,
        priceCents: 13000,
      })
      .returning();
    if (!trip) throw new Error("fixture trip insert returned no row");
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!diver) throw new Error("seed has no people");
    const [booking] = await db
      .insert(bookingsTable)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: diver.id,
        status: "checked_in" as const,
      })
      .returning();
    if (!booking) throw new Error("fixture booking insert returned no row");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded" as const,
      checkpoint: "departure",
      source: "live" as const,
      occurredAt: trip.startsAt,
    });

    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    const returned = state.departures.find((d) => d.tripId === trip.id);
    expect(returned?.status).toBe("unreconciled");
    expect(returned?.gapReason).toBe("after_dive_uncounted");
    // The open count must be acknowledged by name to close — loud, never a lock.
    expect(state.mustAcknowledge.some((d) => d.tripId === trip.id)).toBe(true);

    const record = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: {},
    });
    // The recorded act carries the outstanding count, recomputed server-side.
    const recorded = record.outstanding.departures.find((d) => d.tripId === trip.id);
    expect(recorded).toEqual({
      tripId: trip.id,
      title: "Returned Two-Tank — Molasses",
      status: "unreconciled",
      gapReason: "after_dive_uncounted",
      uncounted: 1,
    });
  });

  it("keeps leftover decisions in the record and treats re-closing as another act, not an edit", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");

    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    const [firstLeftover] = state.leftovers;
    if (!firstLeftover) throw new Error("expected the seed to leave today at least one leftover");

    const first = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: { [firstLeftover.id]: "dismiss" },
    });
    const dismissed = first.outstanding.leftovers.find((l) => l.id === firstLeftover.id);
    expect(dismissed?.decision).toBe("dismiss");
    // Every other leftover defaults to carry — the choice that loses nothing.
    expect(
      first.outstanding.leftovers
        .filter((l) => l.id !== firstLeftover.id)
        .every((l) => l.decision === "carry"),
    ).toBe(true);

    // Dismissal is a memory, not a filter: the queue keeps deriving from the
    // source of truth, so the same row is still there to decide about again.
    const reopened = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(reopened.state.leftovers.some((l) => l.id === firstLeftover.id)).toBe(true);

    const second = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: {},
    });
    const after = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(after.closeCount).toBe(2);
    expect(after.latest?.id).toBe(second.id);
    expect(after.latest?.id).not.toBe(first.id);
  });

  it("refuses to attribute a close to a person from another shop", async () => {
    const { db, shop } = await seededShopContext();
    const [stranger] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!stranger) throw new Error("seed has no people");

    await expect(
      closeDay(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        shopSlug: shop.slug,
        timeZone: shop.timezone,
        actorPersonId: stranger.id,
        decisions: {},
      }),
    ).rejects.toThrow(/not a person of this shop/);
  });
});
