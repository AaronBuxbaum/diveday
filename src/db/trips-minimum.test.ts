import { describe, expect, it } from "vitest";
import { MINIMUM_SEATS_DECISION_HOURS_DEFAULT, minimumSeatsDecisionAt } from "@/lib/minimum-seats";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { getTripWithBooked } from "./trips";
import { createTrip } from "./trips-create";
import {
  cancelDeparturesBelowMinimum,
  listDeparturesAwaitingMinimumDecision,
  listMinimumNotMetRecipients,
  reinstateTripClearingMinimum,
} from "./trips-minimum";

/**
 * The sweep that makes a minimum head count real (ADR
 * 20260813-minimum-head-count-departures). Everything here is about one
 * question the shop has promised a diver an answer to: did it fill by the
 * moment we said we'd decide?
 */

const NOW = new Date("2026-09-01T12:00:00Z");
/** 24h after `NOW`, so a 24-hour window puts the decision exactly at `NOW`. */
const TOMORROW = new Date("2026-09-02T12:00:00Z");

async function departure(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  over: {
    startsAt?: Date;
    capacity?: number;
    minimumBookings?: number | null;
    minimumDecisionHours?: number | null;
    title?: string;
  } = {},
) {
  const startsAt = over.startsAt ?? new Date("2026-09-05T12:00:00Z");
  const trip = await createTrip(db, {
    shopId,
    title: over.title ?? "Minimum-seat charter",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    capacity: over.capacity ?? 9,
    minimumBookings: over.minimumBookings === undefined ? 4 : over.minimumBookings,
    minimumDecisionHours: over.minimumDecisionHours === undefined ? 24 : over.minimumDecisionHours,
  });
  if (!trip) throw new Error("could not create the departure fixture");
  return trip;
}

async function seat(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  tripId: string,
  name: string,
) {
  const outcome = await createBooking(db, {
    shopId,
    tripId,
    actor: "staff",
    fullName: name,
    email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`,
  });
  if (!outcome.ok) throw new Error(`could not seat ${name}: ${outcome.reason}`);
  return outcome;
}

describe("listDeparturesAwaitingMinimumDecision", () => {
  it("ignores a departure that named no minimum", async () => {
    const { db, shop } = await seededShopContext();
    await departure(db, shop.id, {
      startsAt: TOMORROW,
      minimumBookings: null,
      minimumDecisionHours: null,
      title: "No minimum at all",
    });
    const due = await listDeparturesAwaitingMinimumDecision(db, { now: NOW });
    expect(due.map((row) => row.title)).not.toContain("No minimum at all");
  });

  it("ignores one whose decision moment is still ahead", async () => {
    const { db, shop } = await seededShopContext();
    await departure(db, shop.id, {
      startsAt: new Date("2026-09-05T12:00:00Z"),
      minimumDecisionHours: 24,
      title: "Deadline still ahead",
    });
    const due = await listDeparturesAwaitingMinimumDecision(db, { now: NOW });
    expect(due.map((row) => row.title)).not.toContain("Deadline still ahead");
  });

  /**
   * The SQL deadline and `minimumSeatsDecisionAt` are two expressions of one
   * rule, so this asserts them against each other rather than trusting that
   * they look alike: a trip whose computed decision moment is exactly `now` is
   * returned, and one an hour later is not.
   */
  it("lists one at its decision moment, and not one an hour short of it", async () => {
    const { db, shop } = await seededShopContext();
    const at = await departure(db, shop.id, {
      startsAt: TOMORROW,
      minimumDecisionHours: 24,
      title: "Exactly at the moment",
    });
    expect(minimumSeatsDecisionAt({ ...at, minimumDecisionHours: 24 })).toEqual(NOW);
    await departure(db, shop.id, {
      startsAt: TOMORROW,
      minimumDecisionHours: 23,
      title: "An hour short",
    });

    const titles = (await listDeparturesAwaitingMinimumDecision(db, { now: NOW })).map(
      (row) => row.title,
    );
    expect(titles).toContain("Exactly at the moment");
    expect(titles).not.toContain("An hour short");
  });

  it("uses the default window when the shop named a minimum but no window", async () => {
    const { db, shop } = await seededShopContext();
    await departure(db, shop.id, {
      // Exactly the default window ahead of `NOW`, so the decision is due now.
      startsAt: new Date(NOW.getTime() + MINIMUM_SEATS_DECISION_HOURS_DEFAULT * 3_600_000),
      minimumDecisionHours: null,
      title: "Default window",
    });
    const titles = (await listDeparturesAwaitingMinimumDecision(db, { now: NOW })).map(
      (row) => row.title,
    );
    expect(titles).toContain("Default window");
  });

  it("drops one that reached its minimum", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, {
      startsAt: TOMORROW,
      minimumBookings: 2,
      title: "Filled in time",
    });
    await seat(db, shop.id, trip.id, "Ada Filled");
    await seat(db, shop.id, trip.id, "Bo Filled");
    const titles = (await listDeparturesAwaitingMinimumDecision(db, { now: NOW })).map(
      (row) => row.title,
    );
    expect(titles).not.toContain("Filled in time");
  });

  /**
   * A trip that already left is a day that happened. Cancelling one would
   * rewrite it — and after a boat sails the minimum is moot regardless.
   */
  it("never touches a departure that has already left", async () => {
    const { db, shop } = await seededShopContext();
    await departure(db, shop.id, {
      startsAt: new Date("2026-08-30T12:00:00Z"),
      title: "Already sailed",
    });
    const titles = (await listDeparturesAwaitingMinimumDecision(db, { now: NOW })).map(
      (row) => row.title,
    );
    expect(titles).not.toContain("Already sailed");
  });

  it("clamps a minimum above capacity rather than reporting an unreachable one", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, {
      startsAt: TOMORROW,
      capacity: 3,
      minimumBookings: 8,
      title: "Minimum above the boat",
    });
    await seat(db, shop.id, trip.id, "Cy Aboard");
    await seat(db, shop.id, trip.id, "Di Aboard");
    await seat(db, shop.id, trip.id, "Eli Aboard");
    const titles = (await listDeparturesAwaitingMinimumDecision(db, { now: NOW })).map(
      (row) => row.title,
    );
    // Three of three seats sold is every seat there is, so the clamped minimum
    // is met and the departure runs.
    expect(titles).not.toContain("Minimum above the boat");
  });
});

describe("cancelDeparturesBelowMinimum", () => {
  it("cancels the short departure and reports what it was short by", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, {
      startsAt: TOMORROW,
      minimumBookings: 4,
      title: "Two of four",
    });
    await seat(db, shop.id, trip.id, "Fay Short");
    await seat(db, shop.id, trip.id, "Gus Short");

    const result = await cancelDeparturesBelowMinimum(db, { now: NOW });
    const swept = result.cancelled.find((row) => row.tripId === trip.id);
    expect(swept).toMatchObject({ minimum: 4, booked: 2, shopId: shop.id });
    expect((await getTripWithBooked(db, shop.id, trip.id))?.status).toBe("cancelled");
  });

  it("leaves the bookings alone, so the shop still knows who to tell", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, { startsAt: TOMORROW, title: "Who was aboard" });
    await seat(db, shop.id, trip.id, "Hana Told");

    await cancelDeparturesBelowMinimum(db, { now: NOW });
    const recipients = await listMinimumNotMetRecipients(db, shop.id, trip.id);
    expect(recipients.map((row) => row.fullName)).toContain("Hana Told");
    expect(recipients[0]?.email).toBe("hana-told@example.test");
  });

  /**
   * The race a conditional `UPDATE` exists to close: a seat sells between the
   * pass listing this departure and cancelling it. The seat has to win — the
   * boat now makes its numbers, and cancelling it would take a paying diver's
   * seat away over a count that was true a moment ago.
   */
  it("leaves a departure alone when the seat that saves it sells mid-pass", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, {
      startsAt: TOMORROW,
      minimumBookings: 2,
      title: "Saved at the buzzer",
    });
    await seat(db, shop.id, trip.id, "Ivy Early");

    // Exactly what the pass holds after listing: one seat short.
    const due = await listDeparturesAwaitingMinimumDecision(db, { now: NOW });
    expect(due.map((row) => row.tripId)).toContain(trip.id);

    // …and then the second diver books, before the write lands.
    await seat(db, shop.id, trip.id, "Jonas Late");

    const result = await cancelDeparturesBelowMinimum(db, { now: NOW });
    expect(result.cancelled.map((row) => row.tripId)).not.toContain(trip.id);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.status).toBe("scheduled");
  });

  /** A second tick must not re-cancel, re-report, or re-email anybody. */
  it("is a no-op on a second pass", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, { startsAt: TOMORROW, title: "Swept once" });
    const first = await cancelDeparturesBelowMinimum(db, { now: NOW });
    expect(first.cancelled.map((row) => row.tripId)).toContain(trip.id);

    const second = await cancelDeparturesBelowMinimum(db, { now: NOW });
    expect(second.cancelled.map((row) => row.tripId)).not.toContain(trip.id);
  });

  /**
   * Reinstating is the shop overruling the sweep, and it clears the minimum
   * (`reinstateTripAction`). Without that the next tick would cancel the same
   * departure again and the shop would be arguing with a cron job.
   */
  it("does not re-cancel a departure whose minimum a human cleared", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await departure(db, shop.id, { startsAt: TOMORROW, title: "Run it anyway" });
    await cancelDeparturesBelowMinimum(db, { now: NOW });

    await reinstateTripClearingMinimum(db, shop.id, trip.id);

    const again = await cancelDeparturesBelowMinimum(db, { now: NOW });
    expect(again.cancelled.map((row) => row.tripId)).not.toContain(trip.id);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.status).toBe("scheduled");
  });
});
