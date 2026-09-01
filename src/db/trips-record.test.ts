import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { createBoat, deleteBoat } from "./boats";
import { people, rollCallEvents, userAccounts } from "./schema";
import { listTripChangeEvents } from "./trip-change-events";
import {
  createTrip,
  getShopTripTitle,
  getTripRoster,
  getTripWithBooked,
  listStaff,
  listTripDives,
  listTripScheduleDays,
  setTripCrew,
  tripCrewSpokenLanguages,
  upcomingTripsWithCounts,
  updateTrip,
  updateTripConditions,
} from "./trips";

describe("trip records (in-memory PGlite)", () => {
  it("returns only active, assigned crew languages for the public trip line", async () => {
    const { db, shop } = await seededShopContext();
    const reef = (await upcomingTripsWithCounts(db, shop.id)).find(
      (trip) => trip.title === "Two-Tank Reef — Molasses & French",
    );
    if (!reef) throw new Error("expected seeded reef trip missing");
    const [firstCrew, secondCrew] = await listStaff(db, shop.id);
    if (!firstCrew || !secondCrew) throw new Error("expected seeded crew");

    await db
      .update(people)
      .set({ spokenLanguages: ["de", "ja"] })
      .where(eq(people.id, firstCrew.person.id));
    await db
      .update(people)
      .set({ spokenLanguages: ["de", "es"] })
      .where(eq(people.id, secondCrew.person.id));
    expect(
      await setTripCrew(db, shop.id, reef.id, [firstCrew.person.id, secondCrew.person.id]),
    ).toBe(true);
    expect(new Set(await tripCrewSpokenLanguages(db, shop.id, reef.id))).toEqual(
      new Set(["de", "ja", "es"]),
    );

    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, firstCrew.person.id));
    await db
      .update(people)
      .set({ deletedAt: nowDate() })
      .where(and(eq(people.id, secondCrew.person.id), eq(people.shopId, shop.id)));
    expect(await tripCrewSpokenLanguages(db, shop.id, reef.id)).toEqual([]);
  });

  it("stores an optional per-diver price and lets staff update or clear it", async () => {
    const { db, shop } = await seededShopContext();

    const unpriced = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — no price yet",
      startsAt: new Date("2030-08-01T13:00:00.000Z"),
      endsAt: new Date("2030-08-01T17:00:00.000Z"),
      capacity: 10,
    });
    if (!unpriced) throw new Error("trip not created");
    expect(unpriced.priceCents).toBeNull();

    const priced = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — priced",
      startsAt: new Date("2030-08-02T13:00:00.000Z"),
      endsAt: new Date("2030-08-02T17:00:00.000Z"),
      capacity: 10,
      priceCents: 18_000,
    });
    if (!priced) throw new Error("trip not created");
    expect(priced.priceCents).toBe(18_000);

    await updateTrip(db, shop.id, priced.id, {
      title: priced.title,
      startsAt: priced.startsAt,
      endsAt: priced.endsAt,
      capacity: priced.capacity,
      plannedDives: priced.plannedDives,
      priceCents: 20_000,
    });
    expect((await getTripWithBooked(db, shop.id, priced.id))?.priceCents).toBe(20_000);

    await updateTrip(db, shop.id, priced.id, {
      title: priced.title,
      startsAt: priced.startsAt,
      endsAt: priced.endsAt,
      capacity: priced.capacity,
      plannedDives: priced.plannedDives,
      priceCents: null,
    });
    expect((await getTripWithBooked(db, shop.id, priced.id))?.priceCents).toBeNull();
  });

  it("stores an optional meeting point and lets staff clear it back to null (issue #704)", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — needs a meeting point",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T17:00:00.000Z"),
      capacity: 10,
    });
    if (!trip) throw new Error("trip not created");
    expect(trip.meetingPointLabel).toBeNull();
    expect(trip.meetingPointAddress).toBeNull();

    await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      meetingPointLabel: "North Jetty Marina",
      meetingPointAddress: "12 Dock Rd",
    });
    const withMeetingPoint = await getTripWithBooked(db, shop.id, trip.id);
    expect(withMeetingPoint?.meetingPointLabel).toBe("North Jetty Marina");
    expect(withMeetingPoint?.meetingPointAddress).toBe("12 Dock Rd");

    await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      meetingPointLabel: null,
      meetingPointAddress: null,
    });
    const cleared = await getTripWithBooked(db, shop.id, trip.id);
    expect(cleared?.meetingPointLabel).toBeNull();
    expect(cleared?.meetingPointAddress).toBeNull();
  });

  it("records material arrival and conditions changes in the public ledger", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — ledger",
      startsAt: new Date("2030-08-04T13:00:00.000Z"),
      endsAt: new Date("2030-08-04T17:00:00.000Z"),
      capacity: 10,
    });
    if (!trip) throw new Error("trip not created");

    await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      meetingPointLabel: "North Jetty",
      meetingPointAddress: "12 Dock Road",
      arrivalLookFor: "Blue sign",
    });
    const afterArrival = await listTripChangeEvents(db, shop.id, trip.id);
    expect(afterArrival).toHaveLength(1);
    expect(afterArrival[0]).toMatchObject({
      kind: "meeting_point",
      source: "shop",
      beforeValue: { meetingPointLabel: null },
      afterValue: {
        meetingPointLabel: "North Jetty",
        meetingPointAddress: "12 Dock Road",
        arrivalLookFor: "Blue sign",
      },
    });

    await updateTripConditions(db, shop.id, trip.id, {
      conditionsSummary: "Calm water",
      visibilityMeters: 18,
    });
    expect(await listTripChangeEvents(db, shop.id, trip.id)).toHaveLength(2);

    // Re-saving the same facts is not a material change and must not make the
    // ledger look busier than the plan actually was.
    await updateTripConditions(db, shop.id, trip.id, {
      conditionsSummary: "Calm water",
      visibilityMeters: 18,
    });
    expect(await listTripChangeEvents(db, shop.id, trip.id)).toHaveLength(2);
  });

  it("names a departure by id, and never one belonging to another shop", async () => {
    // The Orders index's `?tripId=` line reads this: a filter matching no
    // orders still has to say which boat it filtered for, so the title comes
    // from here rather than from a row the filter just removed.
    const { db, shop } = await seededShopContext();
    const reef = (await upcomingTripsWithCounts(db, shop.id)).find(
      (trip) => trip.title === "Two-Tank Reef — Molasses & French",
    );
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(await getShopTripTitle(db, shop.id, reef.id)).toBe(reef.title);
    // Scoped in the query, so another tenant's id reads as "no such departure"
    // rather than leaking a title across shops.
    expect(await getShopTripTitle(db, "00000000-0000-4000-8000-000000000002", reef.id)).toBeNull();
  });

  it("refuses to shrink capacity below the trip's active booking count", async () => {
    const { db, shop } = await seededShopContext();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    // 9 of 12 booked in the seed.
    const reef = upcoming.find((t) => t.title === "Two-Tank Reef — Molasses & French");
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(reef.booked).toBe(9);

    const refused = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: 8,
      plannedDives: reef.plannedDives,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "capacity_below_booked",
      detail: { bookedCount: 9 },
    });
    // Untouched — the capacity in the database still reads the original value.
    expect((await getTripWithBooked(db, shop.id, reef.id))?.capacity).toBe(reef.capacity);

    const accepted = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: 9,
      plannedDives: reef.plannedDives,
    });
    expect(accepted.ok).toBe(true);
    expect((await getTripWithBooked(db, shop.id, reef.id))?.capacity).toBe(9);
  });

  it("refuses to drop planned dives below a checkpoint staff already recorded a roll call against", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(reef.plannedDives).toBeGreaterThanOrEqual(2);

    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("expected a booking to record a roll call against");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("expected seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "after_dive_2",
      occurredAt: nowDate(),
    });

    const refused = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: 1,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "planned_dives_below_history",
      detail: { recordedDiveCount: 2 },
    });
    expect((await getTripWithBooked(db, shop.id, reef.id))?.plannedDives).toBe(reef.plannedDives);

    // Equal to the recorded history is fine; only going below it is refused.
    const accepted = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: 2,
    });
    expect(accepted.ok).toBe(true);
  });

  it("stores up to four ordered dives while allowing blank dive details", async () => {
    const { db, shop } = await seededShopContext();
    const existing = (await upcomingTripsWithCounts(db, shop.id)).find((trip) => trip.diveSiteId);
    if (!existing) throw new Error("seeded dive site missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Four-dive weekend",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T21:00:00.000Z"),
      capacity: 10,
      plannedDives: 4,
      dives: [
        { title: "Morning reef", diveSiteId: existing.diveSiteId },
        { title: "Second tank", description: "A relaxed second site." },
        {},
        { title: "Sunset drift" },
      ],
    });
    if (!trip) throw new Error("trip not created");

    const dives = await listTripDives(db, shop.id, trip.id);
    expect(dives).toHaveLength(4);
    expect(dives.map(({ dive }) => dive.diveNumber)).toEqual([1, 2, 3, 4]);
    expect(dives[0]?.dive.title).toBe("Morning reef");
    expect(dives[0]?.diveSite?.id).toBe(existing.diveSiteId);
    expect(dives[1]?.dive.description).toBe("A relaxed second site.");
    expect(dives[2]?.dive.title).toBeNull();
    expect(
      await createTrip(db, {
        shopId: shop.id,
        title: "Too many dives",
        startsAt: new Date("2030-08-04T13:00:00.000Z"),
        endsAt: new Date("2030-08-04T21:00:00.000Z"),
        capacity: 10,
        plannedDives: 5,
      }),
    ).toBeNull();
  });

  it("rebuilds a trip's meeting days when its schedule is edited, and never leaves stale ones", async () => {
    // The details editor sends one day's window plus a day count, so a
    // departure can grow, shrink, or slide here rather than being deleted and
    // rebuilt as unrelated trips. A day row left pointing at the old dates is
    // what the manifest, the crew double-booking check, and the trip page's
    // meeting-day list would all go on reading.
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Open Water weekend",
      startsAt: new Date("2030-09-05T12:00:00Z"),
      endsAt: new Date("2030-09-05T16:00:00Z"),
      capacity: 6,
    });
    if (!trip) throw new Error("trip not created");
    // A trip created without days still gets exactly one, from its own window.
    expect(await listTripScheduleDays(db, shop.id, trip.id)).toHaveLength(1);

    const meetingDay = (offset: number) => ({
      dayNumber: offset + 1,
      startsAt: new Date(Date.UTC(2030, 8, 5 + offset, 12)),
      endsAt: new Date(Date.UTC(2030, 8, 5 + offset, 16)),
    });
    const dayOne = meetingDay(0);
    const grown = await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: dayOne.startsAt,
      endsAt: meetingDay(2).endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      scheduleDays: [0, 1, 2].map(meetingDay),
    });
    expect(grown.ok).toBe(true);
    expect(
      (await listTripScheduleDays(db, shop.id, trip.id)).map((day) => [
        day.dayNumber,
        day.startsAt.toISOString(),
      ]),
    ).toEqual([
      [1, "2030-09-05T12:00:00.000Z"],
      [2, "2030-09-06T12:00:00.000Z"],
      [3, "2030-09-07T12:00:00.000Z"],
    ]);
    // The trip itself spans first departure to last return, so every
    // "is it over?" question sees the whole departure.
    expect((await getTripWithBooked(db, shop.id, trip.id))?.endsAt).toEqual(
      new Date("2030-09-07T16:00:00.000Z"),
    );

    // Shrinking replaces rather than merges: days 2 and 3 are gone, not orphaned.
    const shrunk = await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: dayOne.startsAt,
      endsAt: dayOne.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      scheduleDays: [dayOne],
    });
    expect(shrunk.ok).toBe(true);
    expect(await listTripScheduleDays(db, shop.id, trip.id)).toHaveLength(1);

    // Omitting the field leaves the existing days entirely alone — every
    // caller that only edits a price must not silently rewrite a schedule.
    await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: dayOne.startsAt,
      endsAt: dayOne.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      priceCents: 12_000,
    });
    expect(await listTripScheduleDays(db, shop.id, trip.id)).toHaveLength(1);
  });

  it("stores a private charter trip and retrieves its private status", async () => {
    const { db, shop } = await seededShopContext();

    const privateTrip = await createTrip(db, {
      shopId: shop.id,
      title: "Private Sunset Charter",
      startsAt: new Date("2030-08-01T17:00:00.000Z"),
      endsAt: new Date("2030-08-01T20:00:00.000Z"),
      capacity: 12,
      isPrivate: true,
    });
    if (!privateTrip) throw new Error("private trip not created");
    expect(privateTrip.isPrivate).toBe(true);

    const fetched = await getTripWithBooked(db, shop.id, privateTrip.id);
    expect(fetched?.isPrivate).toBe(true);

    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const found = upcoming.find((t) => t.id === privateTrip.id);
    expect(found?.isPrivate).toBe(true);
  });
});

/**
 * **The departure's own three, editable after creation** (issue #681).
 *
 * `boat_id`, `dive_mode` and `is_private` were writable only at the insert. So
 * the commonest real edit — the boat that was going to run this is in for
 * service, move it to the other hull — was impossible, and
 * delete-and-recreate is not available once anyone has booked, because
 * `deleteTrip` refuses a departure carrying bookings.
 */
describe("editing a departure's boat, mode and public sale", () => {
  async function boatTrip() {
    const { db, shop } = await seededShopContext();
    const hull = await createBoat(db, shop.id, "Reef Runner", 12);
    const spare = await createBoat(db, shop.id, "Blue Horizon", 12);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T17:00:00.000Z"),
      capacity: 10,
      plannedDives: 2,
      diveMode: "boat",
      boatId: hull.id,
      isPrivate: false,
    });
    if (!trip) throw new Error("trip not created");
    return { db, shop, trip, hull, spare };
  }

  const patch = (trip: { title: string; startsAt: Date; endsAt: Date }) => ({
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    capacity: 10,
    plannedDives: 2,
  });

  it("moves a departure to another hull", async () => {
    const { db, shop, trip, spare } = await boatTrip();

    const outcome = await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: spare.id });

    expect(outcome.ok).toBe(true);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.boatId).toBe(spare.id);
  });

  it("takes a departure off its hull entirely", async () => {
    // "No boat" is a real answer, not a missing one.
    const { db, shop, trip } = await boatTrip();
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: null });
    expect((await getTripWithBooked(db, shop.id, trip.id))?.boatId).toBeNull();
  });

  it("turns a boat dive into a shore dive", async () => {
    // What a marginal-weather morning actually becomes.
    const { db, shop, trip } = await boatTrip();
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), diveMode: "shore", boatId: null });
    const after = await getTripWithBooked(db, shop.id, trip.id);
    expect(after?.diveMode).toBe("shore");
    expect(after?.boatId).toBeNull();
  });

  it("puts a private departure on public sale, and back", async () => {
    // A one-way door in both directions until now: a private charter whose
    // group fell through could never be sold publicly.
    const { db, shop, trip } = await boatTrip();
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), isPrivate: true });
    expect((await getTripWithBooked(db, shop.id, trip.id))?.isPrivate).toBe(true);
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), isPrivate: false });
    expect((await getTripWithBooked(db, shop.id, trip.id))?.isPrivate).toBe(false);
  });

  it("leaves all three alone when the edit does not carry them", async () => {
    // The reason each is `undefined`-guarded: a form without the field must not
    // write a default over the shop's own answer.
    const { db, shop, trip, hull } = await boatTrip();
    await updateTrip(db, shop.id, trip.id, { ...patch(trip), title: "Renamed" });
    const after = await getTripWithBooked(db, shop.id, trip.id);
    expect(after?.title).toBe("Renamed");
    expect(after?.boatId).toBe(hull.id);
    expect(after?.diveMode).toBe("boat");
    expect(after?.isPrivate).toBe(false);
  });

  it("refuses a hull belonging to another shop", async () => {
    // The edit form must not become the cross-tenant door `createTrip` closes.
    const { db, shop, trip } = await boatTrip();
    const other = await seededShopContext();
    const theirs = await createBoat(other.db, other.shop.id, "Their Boat", 12);

    const outcome = await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: theirs.id });

    expect(outcome).toMatchObject({ ok: false, reason: "boat_not_found" });
  });

  it("refuses a hull the shop has deleted", async () => {
    const { db, shop, trip, spare } = await boatTrip();
    await deleteBoat(db, shop.id, spare.id);

    const outcome = await updateTrip(db, shop.id, trip.id, { ...patch(trip), boatId: spare.id });

    expect(outcome).toMatchObject({ ok: false, reason: "boat_not_found" });
  });
});
