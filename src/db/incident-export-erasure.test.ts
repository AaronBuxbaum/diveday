import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { cancelBooking, restoreBooking, splitBookingIdentity } from "./bookings";
import { getIncidentExport } from "./incident-export";
import { activityEvents, bookings, people } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **An erased diver's late seat change leaves no name on the departure log**
 * (security review 2026-10-16, F1). The log prints a seat taken off after the
 * boat was due out, by the name the trail wrote at the time. Erasure reached
 * that line only by matching the diver's *current* name against its params, so
 * a diver renamed since, or a held seat booked under another name, kept their
 * name on the hashed document after asking to be forgotten. The line now
 * carries whose seat it was by record, and erasure reaches it by that.
 */
async function lateRemoval(options: { bookedAs?: string; renameTo?: string }) {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"))?.person;
  if (!reef || !owner) throw new Error("demo reef trip and owner missing");
  const [first] = await getTripRoster(db, shop.id, reef.id);
  if (!first) throw new Error("demo booking missing");
  await db.update(people).set({ fullName: "Jo Smith" }).where(eq(people.id, first.person.id));
  if (options.bookedAs) {
    await db.update(people).set({ fullName: "Joanna Smith" }).where(eq(people.id, first.person.id));
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2026-10-01T12:00:00Z"),
        identityBookedAs: options.bookedAs,
      })
      .where(eq(bookings.id, first.booking.id));
  }
  await cancelBooking(db, shop.id, first.booking.id, { trail: { actorPersonId: owner.id } });
  // Twenty minutes after the boat was due out, so the log prints it.
  await db
    .update(activityEvents)
    .set({ occurredAt: new Date(reef.startsAt.getTime() + 20 * 60_000) })
    .where(and(eq(activityEvents.tripId, reef.id), eq(activityEvents.code, "booking_removed")));
  if (options.renameTo) {
    await db
      .update(people)
      .set({ fullName: options.renameTo })
      .where(eq(people.id, first.person.id));
  }
  const before = await getIncidentExport(db, shop.id, reef.id, owner.id);
  expect(before?.timeline).toContainEqual(
    expect.objectContaining({ kind: "roster_change", subjectName: "Jo Smith" }),
  );
  const erased = await anonymizeDiver(db, {
    shopId: shop.id,
    personId: first.person.id,
    actorPersonId: owner.id,
  });
  expect(erased.ok).toBe(true);
  return getIncidentExport(db, shop.id, reef.id, owner.id);
}

describe("an erased diver's seat change on the departure log", () => {
  it("leaves no name when the diver was renamed after the change", async () => {
    const after = await lateRemoval({ renameTo: "Josephine Okafor" });
    expect(JSON.stringify(after)).not.toContain("Jo Smith");
    // The head count still learns a seat changed then, naming nobody
    // (auditor review 2026-10-16, item 12).
    expect(after?.timeline).toContainEqual(
      expect.objectContaining({ kind: "roster_change", action: "erased", subjectName: "" }),
    );
  });

  it("leaves no name when the held seat was booked under another name", async () => {
    const after = await lateRemoval({ bookedAs: "Jo Smith" });
    expect(JSON.stringify(after)).not.toContain("Jo Smith");
  });
});

describe("a held seat's late lines, once the seat is split off", () => {
  it("leave no name when the person it was split to is erased", async () => {
    // Security re-review 2026-10-16, item 1: the lines named the matched
    // person by record and "Jo Smith" by name. The split moved the seat to a
    // new record; erasing that record reached neither.
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"))?.person;
    if (!reef || !owner) throw new Error("demo reef trip and owner missing");
    const [first] = await getTripRoster(db, shop.id, reef.id);
    if (!first) throw new Error("demo booking missing");
    await db.update(people).set({ fullName: "Mary Smith" }).where(eq(people.id, first.person.id));
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2026-07-01T12:00:00Z"),
        identityBookedAs: "Jo Smith",
      })
      .where(eq(bookings.id, first.booking.id));
    await cancelBooking(db, shop.id, first.booking.id, { trail: { actorPersonId: owner.id } });
    expect(
      await restoreBooking(db, shop.id, first.booking.id, { actorPersonId: owner.id }),
    ).not.toBe("not_found");
    await db
      .update(activityEvents)
      .set({ occurredAt: new Date(reef.startsAt.getTime() + 20 * 60_000) })
      .where(eq(activityEvents.tripId, reef.id));
    const split = await splitBookingIdentity(db, {
      shopId: shop.id,
      bookingId: first.booking.id,
      actorPersonId: owner.id,
      fullName: "Joanna Smith",
      adultAttested: true,
    });
    if (!split.ok) throw new Error(`split refused: ${split.reason}`);
    const before = await getIncidentExport(db, shop.id, reef.id, owner.id);
    expect(JSON.stringify(before?.timeline)).toContain("Jo Smith");
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: split.personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);
    const after = await getIncidentExport(db, shop.id, reef.id, owner.id);
    expect(JSON.stringify(after)).not.toContain("Jo Smith");
  });
});
