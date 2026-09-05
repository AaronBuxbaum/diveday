import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { assembleEveningClose } from "@/lib/closeout";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  closeDay,
  getDayCloseout,
  listLatestLeftoverDecisions,
  recordLeftoverDecision,
} from "./closeout";
import { addCrewRecapPhoto } from "./recap";
import { listShopReviewsForStaff, submitTripReview } from "./reviews";
import {
  bookings as bookingsTable,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips as tripsTable,
} from "./schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { listStaff, upcomingTripsWithCounts } from "./trips";

const HOUR = 60 * 60 * 1000;

describe("day close-out (in-memory PGlite)", () => {
  it("assembles today's state and records the act with what was outstanding", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");

    const now = new Date(nowMs() + 60 * 60 * 1000); // 10:30 AM
    const before = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
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
      now,
    });
    expect(record.actorName).toBe(staff.person.fullName);
    expect(record.shopDay).toBe(before.state.shopDay);

    const after = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
    expect(after.closeCount).toBe(1);
    expect(after.latest?.id).toBe(record.id);
    expect(after.latest?.actorName).toBe(staff.person.fullName);
  });

  it("seeds a completed local-day dive and its post-dive report progress", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date(nowMs() + 60 * 60 * 1000); // 10:30 AM
    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
    const completed = state.departures.find(
      (departure) => departure.title === DEMO_COMPLETED_TRIP_TITLE,
    );

    expect(completed).toMatchObject({
      status: "all_home",
      ended: true,
      booked: 8,
    });
    expect(state.adminTasks).toEqual([
      {
        id: "post_dive_reports",
        status: "pending",
        total: 8,
        completed: 6,
        pending: 2,
        failed: 0,
      },
    ]);
    // The task rides the departure it is about, not an invisible side channel
    // below an "everyone is home" message — so the departure it belongs to is
    // the one that has to be on the day.
    expect(completed?.ended).toBe(true);
  });

  it("carries a crew photo onto its departure's settled station", async () => {
    const { db, shop } = await seededShopContext();
    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    const completed = state.departures.find(
      (departure) => departure.title === DEMO_COMPLETED_TRIP_TITLE,
    );
    const [staff] = await listStaff(db, shop.id);
    if (!completed || !staff) throw new Error("completed trip and staff fixture required");

    const added = await addCrewRecapPhoto(db, {
      shopId: shop.id,
      tripId: completed.tripId,
      uploadedByPersonId: staff.person.id,
      imageUrl: "https://img/crew-closeout.jpg",
      now: new Date(nowMs()),
    });
    if (!added.ok) throw new Error("crew photo should be accepted for a completed trip");

    const refreshed = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(
      refreshed.state.departures.find((departure) => departure.tripId === completed.tripId)
        ?.crewPhotos,
    ).toContainEqual(expect.objectContaining(added.photo));
  });

  it("records the unreconciled head count that was open, and never refuses the close over it", async () => {
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

    // **Nothing stands in front of the act.** This used to throw
    // `CloseoutAcknowledgementRequired` unless the form carried a ticked
    // checkbox — a confirm on an append-only act, re-asking a decision H-57
    // has the shop making per row as it meets it (ADR
    // 20260827-clearwater-surface-language's rejected alternative). Closing
    // over an open head count is recorded, loudly and by name, and never
    // refused; nothing downstream conditions on the row existing, and the
    // chase carries on exactly as before.
    const again = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: {},
    });
    expect(again.outstanding.departures.map((d) => d.tripId)).toContain(trip.id);
  });

  it("keeps leftover decisions in the record and treats re-closing as another act, not an edit", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");

    const now = new Date(nowMs() + 60 * 60 * 1000); // 10:30 AM
    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
    const [firstLeftover] = state.leftovers;
    if (!firstLeftover) throw new Error("expected the seed to leave today at least one leftover");

    const first = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: { [firstLeftover.id]: "dismiss" },
      now,
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
    const reopened = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
    expect(reopened.state.leftovers.some((l) => l.id === firstLeftover.id)).toBe(true);

    const second = await closeDay(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      timeZone: shop.timezone,
      actorPersonId: staff.person.id,
      decisions: {},
      now,
    });
    const after = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
    expect(after.closeCount).toBe(2);
    expect(after.latest?.id).toBe(second.id);
    expect(after.latest?.id).not.toBe(first.id);
  });

  it("persists each leftover tap immediately and resolves the append-only trail last-write-wins", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    const now = new Date(nowMs() + 60 * 60 * 1000);
    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
    const [leftover] = state.leftovers;
    if (!leftover) throw new Error("expected a leftover");

    await recordLeftoverDecision(db, {
      shopId: shop.id,
      shopDay: state.shopDay,
      actionId: leftover.id,
      decision: "dismiss",
      actorPersonId: staff.person.id,
      decidedAt: now,
    });
    expect(
      (await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now)).state.leftoverDecisions[
        leftover.id
      ],
    ).toBe("dismiss");

    await recordLeftoverDecision(db, {
      shopId: shop.id,
      shopDay: state.shopDay,
      actionId: leftover.id,
      decision: "carry",
      actorPersonId: staff.person.id,
      decidedAt: new Date(now.getTime() + 1),
    });
    expect(await listLatestLeftoverDecisions(db, shop.id, state.shopDay)).toEqual({
      [leftover.id]: "carry",
    });
    await expect(
      recordLeftoverDecision(db, {
        shopId: shop.id,
        shopDay: state.shopDay,
        actionId: leftover.id,
        decision: "dismiss",
        actorPersonId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/not a person of this shop/);
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

  /**
   * **The evening reads the assigned crew, not whoever has a result** (issue
   * #1346). `listRollCallGaps` counts only crew who already carry one, which
   * is why a shop that has never tapped a crew roll call could reach "all
   * boats are home" over a boat whose manifest said `crew_awaiting`.
   */
  describe("the crew the evening counts", () => {
    const crewOfCompletedTrip = async () => {
      const { db, shop } = await seededShopContext();
      const now = new Date(nowMs() + HOUR);
      const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
      const completed = state.departures.find(
        (departure) => departure.title === DEMO_COMPLETED_TRIP_TITLE,
      );
      if (!completed) throw new Error("seeded completed trip missing");
      return { db, shop, now, completed };
    };

    it("names every rostered crew member, with no result until somebody records one", async () => {
      const { db, completed } = await crewOfCompletedTrip();
      const assigned = await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, completed.tripId));

      expect(completed.crew).toHaveLength(assigned.length);
      expect(assigned.length).toBeGreaterThan(0);
      // No seed writes a `roll_call_crew_events` row, so absence is what the
      // evening sees — and absence is awaiting, never accounted for.
      expect(completed.crew.every((member) => member.rollCall === undefined)).toBe(true);
      expect(assembleEveningClose([completed]).allHome).toBe(false);
    });

    it("takes the last write per person, so an undone tap satisfies nothing", async () => {
      const { db, shop, now, completed } = await crewOfCompletedTrip();
      const [staff] = await listStaff(db, shop.id);
      if (!staff) throw new Error("seed staff missing");
      const assigned = await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, completed.tripId));
      const checkpoints = rollCallCheckpoints(completed.plannedDives);

      const boarded = assigned.flatMap((crew, index) =>
        checkpoints.map((checkpoint, step) => ({
          shopId: shop.id,
          tripId: completed.tripId,
          personId: crew.personId,
          recordedByPersonId: staff.person.id,
          status: "boarded" as const,
          checkpoint,
          source: "live" as const,
          occurredAt: new Date(completed.startsAt.getTime() + (step * 10 + index) * 60_000),
        })),
      );
      await db.insert(rollCallCrewEvents).values(boarded);

      const counted = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
      const withCrew = counted.state.departures.find(
        (departure) => departure.title === DEMO_COMPLETED_TRIP_TITLE,
      );
      expect(assembleEveningClose([withCrew ?? completed]).stations[0]?.crewAccountedFor).toBe(
        true,
      );

      // One person's closing result is then cleared, which every reader of
      // this trail collapses to "no result".
      const firstCrew = assigned[0];
      const closing = checkpoints.at(-1);
      if (!firstCrew || !closing) throw new Error("no crew or checkpoint");
      await db.insert(rollCallCrewEvents).values({
        shopId: shop.id,
        tripId: completed.tripId,
        personId: firstCrew.personId,
        recordedByPersonId: staff.person.id,
        status: "cleared",
        checkpoint: closing,
        source: "live",
        occurredAt: new Date(completed.endsAt.getTime()),
      });

      const undone = await getDayCloseout(db, shop.id, shop.slug, shop.timezone, now);
      const afterUndo = undone.state.departures.find(
        (departure) => departure.title === DEMO_COMPLETED_TRIP_TITLE,
      );
      if (!afterUndo) throw new Error("seeded completed trip missing");
      expect(assembleEveningClose([afterUndo]).stations[0]?.crewAccountedFor).toBe(false);
    });

    it("is tenant-safe: another shop's day never reaches this roster", async () => {
      const { db, shop, now } = await crewOfCompletedTrip();
      const other = await getDayCloseout(
        db,
        "00000000-0000-4000-8000-000000000000",
        "other-shop",
        shop.timezone,
        now,
      );
      expect(other.state.departures).toEqual([]);
    });
  });

  it("carries Today's deep-linked reviews row into the leftovers unchanged", async () => {
    // Close-out renders the Today queue verbatim, so the one waiting review's
    // anchor has to survive the trip — the evening reader gets the same door
    // the morning one did, not the top of the index.
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Reviewing Diver",
        email: "closeout-review@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const submitted = await submitTripReview(db, {
      bookingId: party.bookings[0].bookingId,
      rating: 5,
      comment: "Crew were superb",
    });
    if (!submitted.ok) throw new Error(`review refused: ${submitted.reason}`);
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;

    const { state } = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    const rows = state.leftovers.filter((action) => action.id === "reviews:pending");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe(`/shop/${shop.slug}/reviews#review-${review.id}`);
  });
});
