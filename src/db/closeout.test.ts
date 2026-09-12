import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { assembleEveningClose } from "@/lib/closeout";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { seededShopContext } from "@/test/db";
import { standingArrivalStatus } from "./arrival-provenance";
import { createBookingParty } from "./bookings";
import {
  closeDay,
  getDayCloseout,
  listLatestLeftoverDecisions,
  recordLeftoverDecision,
} from "./closeout";
import { recordRollCall } from "./manifests";
import { markBookingNoShow } from "./no-show";
import { addCrewRecapPhoto } from "./recap";
import { listShopReviewsForStaff, submitTripReview } from "./reviews";
import {
  bookingArrivalEvents,
  bookings as bookingsTable,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips as tripsTable,
} from "./schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { recordTripStage } from "./trip-stages";
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

  /**
   * **What the evening counts as having been aboard** (issue #1689).
   *
   * The homecoming sentence used to sum the roster, so a diver a staffer
   * marked absent at the desk went out *and* came home. Both numbers moved
   * together, which is why arithmetic alone never caught it — `out === back`
   * held over a boat whose own records said one of those souls never sailed.
   */
  describe("the divers the evening counts as sailed", () => {
    /**
     * A boat that left five hours ago and tied up two: sailed, home, and
     * still inside the counter's own backward reach, so
     * `markBookingNoShow` — the product's only writer of that status — is
     * the thing under test rather than a hand-written row.
     */
    const boatThatSailedShort = async () => {
      const { db, shop } = await seededShopContext();
      const [staff] = await listStaff(db, shop.id);
      if (!staff) throw new Error("seed staff missing");
      const now = new Date(nowMs() + HOUR);
      const [trip] = await db
        .insert(tripsTable)
        .values({
          shopId: shop.id,
          title: "Sailed Short — Molasses",
          startsAt: new Date(now.getTime() - 5 * HOUR),
          endsAt: new Date(now.getTime() - 2 * HOUR),
          capacity: 12,
          plannedDives: 1,
          priceCents: 13000,
        })
        .returning();
      if (!trip) throw new Error("fixture trip insert returned no row");
      const divers = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.shopId, shop.id))
        .limit(3);
      if (divers.length < 3) throw new Error("seed has too few people");
      return { db, shop, staff, now, trip, divers };
    };

    const seat = async (
      db: Awaited<ReturnType<typeof boatThatSailedShort>>["db"],
      values: { shopId: string; tripId: string; personId: string; status: "booked" | "checked_in" },
    ) => {
      const [booking] = await db.insert(bookingsTable).values(values).returning();
      if (!booking) throw new Error("fixture booking insert returned no row");
      return booking;
    };

    const departureOf = async (
      ctx: Awaited<ReturnType<typeof boatThatSailedShort>>,
      tripId: string,
    ) => {
      const { state } = await getDayCloseout(
        ctx.db,
        ctx.shop.id,
        ctx.shop.slug,
        ctx.shop.timezone,
        ctx.now,
      );
      const departure = state.departures.find((row) => row.tripId === tripId);
      if (!departure) throw new Error("fixture departure missing from today's closeout");
      return departure;
    };

    it("drops a seat the desk marked no-show, and leaves the roster and the shelf alone", async () => {
      const ctx = await boatThatSailedShort();
      const { db, shop, staff, now, trip, divers } = ctx;
      const sailing = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[0].id,
        status: "booked",
      });
      const absent = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[1].id,
        status: "booked",
      });

      const before = await departureOf(ctx, trip.id);
      expect([before.booked, before.sailed]).toEqual([2, 2]);

      const marked = await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: absent.id,
        recordedByPersonId: staff.person.id,
        now,
      });
      if (!marked.ok) throw new Error(`no-show refused: ${marked.reason}`);

      const after = await departureOf(ctx, trip.id);
      // The roster is untouched — two people bought seats on this boat, and
      // that stays true tonight. One of them was aboard.
      expect([after.booked, after.sailed]).toEqual([2, 1]);
      const evening = assembleEveningClose([after], now);
      expect([evening.divers, evening.back]).toEqual([1, 1]);
      // **The debrief still reads the seats.** Ten of twelve went unsold, and
      // narrowing the shared count would have quietly made it eleven.
      expect(after.openSeats?.openSeats).toBe(10);
      expect(sailing.status).toBe("booked");
    });

    it("keeps a checked-in diver out of the count once the desk says they never came", async () => {
      // **The adversarial case, and it lands the opposite way round from the
      // one #1558 imagined.** This booking has a standing `arrived` row: a
      // staffer tapped them in at the desk, and `markBookingNoShow` leaves
      // that trail alone on purpose. The mark is still the later human
      // statement — made by somebody looking at the empty space — so it is
      // the one the count follows, exactly as the dive-day readers were
      // changed to do on 2026-09-11 (`standingArrivalStatus`,
      // src/db/arrival-provenance.ts). A sighting at the desk at 06:40 is not
      // a body on the boat at 06:50.
      //
      // The rail is the statement that *does* outrank it, and it needs no
      // reader here: boarding a diver marked absent puts the booking back to
      // `booked` (`reclaimReleasedSeat`, src/db/manifests.ts), so a diver the
      // crew counted is never sitting at `no_show` when the evening reads it.
      const ctx = await boatThatSailedShort();
      const { db, shop, staff, now, trip, divers } = ctx;
      await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[0].id,
        status: "booked",
      });
      const seen = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[1].id,
        status: "checked_in",
      });
      await db.insert(bookingArrivalEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seen.id,
        recordedByPersonId: staff.person.id,
        status: "arrived",
        source: "live",
        occurredAt: new Date(now.getTime() - 6 * HOUR),
      });
      expect(await standingArrivalStatus(db, shop.id, trip.id, seen.id)).toBe("arrived");

      const marked = await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: seen.id,
        recordedByPersonId: staff.person.id,
        now,
      });
      if (!marked.ok) throw new Error(`no-show refused: ${marked.reason}`);
      // The sighting is still on the trail; it simply does not answer this
      // question.
      expect(await standingArrivalStatus(db, shop.id, trip.id, seen.id)).toBe("arrived");

      const after = await departureOf(ctx, trip.id);
      expect([after.booked, after.sailed]).toEqual([2, 1]);
      expect(assembleEveningClose([after], now).divers).toBe(1);
    });

    /**
     * **The load-bearing case, and the one the first fix of #1689 missed**
     * (review finding 1).
     *
     * This is what closing the dock count looks like at a busy dock: the crew
     * tap "Not boarded" for the diver who never showed, and nobody at the desk
     * ever does the "Not here?" tap. `bookings.status` stays `booked`, so a
     * count that reads status alone put that diver out *and* home — and
     * because the crew *did* finish their count there is no gap, the station
     * reads `all_home`, and the evening said so over a boat that carried one.
     */
    it("drops a seat the crew marked not boarded at the dock, with no desk mark at all", async () => {
      const ctx = await boatThatSailedShort();
      const { db, shop, staff, now, trip, divers } = ctx;
      const aboard = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[0].id,
        status: "booked",
      });
      const ashore = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[1].id,
        status: "booked",
      });

      // The diver the crew left ashore, through the product's own writer —
      // that tap is what this case is about. It needs no readiness fixture: a
      // `not_boarded` is never gated, because refusing to record that somebody
      // is *not* on the boat has no safe direction.
      const left = await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: ashore.id,
        recordedByPersonId: staff.person.id,
        status: "not_boarded",
        occurredAt: new Date(trip.startsAt.getTime() + 60_000),
      });
      if (!left.ok) throw new Error(`roll call refused: ${left.reason}`);
      // And the diver who sailed, written straight in: `recordRollCall` gates
      // a `boarded` at departure on readiness, and a waiver fixture would only
      // make this case about a rule it is not testing. What it does need is the
      // dock count *closed*, so that nothing else on the row is holding the
      // station open.
      await db.insert(rollCallEvents).values(
        rollCallCheckpoints(trip.plannedDives).map((checkpoint, step) => ({
          shopId: shop.id,
          tripId: trip.id,
          bookingId: aboard.id,
          recordedByPersonId: staff.person.id,
          status: "boarded" as const,
          checkpoint,
          source: "live" as const,
          occurredAt: new Date(trip.startsAt.getTime() + (step + 1) * 60_000),
        })),
      );

      const after = await departureOf(ctx, trip.id);
      // Nobody was marked absent at the desk, so a status-only count still
      // reads two.
      const [absent] = await db
        .select({ status: bookingsTable.status })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, ashore.id));
      expect(absent?.status).toBe("booked");
      expect([after.booked, after.sailed]).toEqual([2, 1]);
      // No gap, so the station settles clean — which is exactly why the number
      // had to be right: there is nothing else on this row to catch it.
      expect(after.status).toBe("all_home");
      const evening = assembleEveningClose([after], now);
      expect([evening.divers, evening.back]).toEqual([1, 1]);
      expect(after.openSeats?.openSeats).toBe(10);
    });

    /**
     * **A diver who did not come back from a dive sailed** — the adversarial
     * twin of the case above, and the reason the dock result is read through a
     * departure-pinned reader.
     *
     * `not_boarded` means two opposite things by checkpoint: "never left the
     * dock" at `departure`, and "did not return to the boat" after a dive
     * (DOM-H3). Reading the second as the first would take the missing diver
     * out of the count that says somebody is still in the water — the worst
     * failure this surface has.
     */
    it("keeps a diver the crew marked not back aboard after a dive in the count", async () => {
      const ctx = await boatThatSailedShort();
      const { db, shop, staff, now, trip, divers } = ctx;
      const booking = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[0].id,
        status: "booked",
      });
      await db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        status: "boarded" as const,
        checkpoint: "departure",
        source: "live" as const,
        occurredAt: new Date(trip.startsAt.getTime() + 60_000),
      });
      // The alarm, through the writer that raises it.
      const missing = await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(trip.startsAt.getTime() + 2 * 60_000),
      });
      if (!missing.ok) throw new Error(`roll call refused: ${missing.reason}`);

      const after = await departureOf(ctx, trip.id);
      expect([after.booked, after.sailed]).toEqual([1, 1]);
      // They sailed, and they are the one the day is still looking for.
      expect([after.status, after.gapReason]).toEqual(["unreconciled", "missing_diver"]);
      const evening = assembleEveningClose([after], now);
      expect([evening.divers, evening.stations[0]?.back]).toEqual([1, 0]);
      expect(evening.allHome).toBe(false);
    });

    /**
     * **The safety claim the count rests on, asserted at this layer** (review
     * finding 4).
     *
     * `seatSailed` drops a `no_show` seat that has no dock result, which is
     * only safe because a `no_show` can never stand over a diver the crew
     * recorded aboard: `noShowGate` refuses `already_boarded` ahead of every
     * other condition, and a boarding that arrives second takes the released
     * seat straight back (`reclaimReleasedSeat`). Nothing asserted that here,
     * and the whole of `sailed` leans on it.
     */
    it("counts a released seat again the moment the crew board that diver", async () => {
      const ctx = await boatThatSailedShort();
      const { db, shop, staff, now, trip, divers } = ctx;
      await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[0].id,
        status: "booked",
      });
      const released = await seat(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: divers[1].id,
        status: "booked",
      });
      const marked = await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: released.id,
        recordedByPersonId: staff.person.id,
        now,
      });
      if (!marked.ok) throw new Error(`no-show refused: ${marked.reason}`);
      expect((await departureOf(ctx, trip.id)).sailed).toBe(1);

      // The rail contradicts the desk, and the rail wins. At `after_dive_1`
      // deliberately: that is `inAfterDivePopulation`'s own case — a diver the
      // crew counted without a dock result — it is the checkpoint the counter
      // used to be blind to (`onTheWaterByRollCall`), and readiness gates a
      // `boarded` only at departure, so the real writer runs here with no
      // waiver fixture standing in front of it.
      const boarded = await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: released.id,
        recordedByPersonId: staff.person.id,
        status: "boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(trip.startsAt.getTime() + 60_000),
      });
      if (!boarded.ok) throw new Error(`roll call refused: ${boarded.reason}`);

      const [reclaimed] = await db
        .select({ status: bookingsTable.status })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, released.id));
      expect(reclaimed?.status).toBe("booked");
      expect((await departureOf(ctx, trip.id)).sailed).toBe(2);
    });
  });

  it("settles a departure the return buffer still calls still out, once the crew tap Home", async () => {
    // **Issue #1480, through the plumbing.** The promotion is decided in
    // `src/lib/closeout.ts`, but it only ever fires if the db half actually
    // carries the crew's last tap onto the departure — this is the test that
    // catches that being forgotten.
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");

    // Due back five minutes ago: `hasReturned` says no for another 55.
    const endsAt = new Date(nowMs() - 5 * 60 * 1000);
    const [trip] = await db
      .insert(tripsTable)
      .values({
        shopId: shop.id,
        title: "Just In — Molasses & French",
        startsAt: new Date(endsAt.getTime() - 4 * HOUR),
        endsAt,
        capacity: 12,
        plannedDives: 2,
        priceCents: 13000,
      })
      .returning();
    if (!trip) throw new Error("fixture trip insert returned no row");

    const before = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(before.state.departures.find((d) => d.tripId === trip.id)?.status).toBe("still_out");

    const tap = await recordTripStage(db, {
      shopId: shop.id,
      tripId: trip.id,
      stage: "home",
      recordedByPersonId: staff.person.id,
    });
    if (!tap.ok) throw new Error(`stage refused: ${tap.reason}`);

    const after = await getDayCloseout(db, shop.id, shop.slug, shop.timezone);
    expect(after.state.departures.find((d) => d.tripId === trip.id)?.status).toBe("all_home");
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
