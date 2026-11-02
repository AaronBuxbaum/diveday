import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { TodayAction } from "@/lib/today";
import { sortStationRows } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import {
  rollCallCrewEvents as rollCallCrewEventsTable,
  rollCallEvents as rollCallEventsTable,
  tripAssignments,
} from "./schema";
import { getTodayWork } from "./today";
import { pushRollCallRows } from "./today-roll-call-rows";
import {
  boardAtDeparture,
  HOUR,
  returnedTrip,
  rollCallRow,
  rollCallRows,
} from "./today-roll-call-test-fixtures";
import { rowsContext } from "./today-rows-test-fixtures";
import { listStaff } from "./trips";

describe("pushRollCallRows", () => {
  it("adds nothing when every boat is home, counted and crewed once", () => {
    const actions: TodayAction[] = [];
    pushRollCallRows(
      actions,
      rowsContext({
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: [],
        crewClashState: {
          departures: [],
          clashes: new Map(),
          boatClashes: new Map(),
          crew: new Map(),
          divers: new Map(),
        },
      }),
    );
    expect(actions).toEqual([]);
  });

  it("leaves an earlier row where it was: it only ever appends", () => {
    const earlier = { id: "earlier" } as TodayAction;
    const actions: TodayAction[] = [earlier];
    pushRollCallRows(
      actions,
      rowsContext({
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: [],
        crewClashState: {
          departures: [],
          clashes: new Map(),
          boatClashes: new Map(),
          crew: new Map(),
          divers: new Map(),
        },
      }),
    );
    expect(actions).toEqual([earlier]);
  });
});

/** Batch 6, item 6: the row for a count the owners were alerted about says so. */
describe("pushRollCallRows after the stale-roll-call alert", () => {
  const gap = {
    tripId: "t-1",
    title: "Two-Tank Reef",
    startsAt: new Date("2026-07-21T12:00:00Z"),
    endsAt: new Date("2026-07-21T16:00:00Z"),
    capacity: 12,
    priceCents: null,
    reason: "after_dive_uncounted" as const,
    diveNumber: 2,
    uncounted: 2,
    total: 8,
    rosterSize: 8,
    underway: false,
    stale: false,
  };
  const rows = (alertedAt: Date | null, shoreAlertedAt: Date | null = null) => {
    const actions: TodayAction[] = [];
    pushRollCallRows(
      actions,
      rowsContext({
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: [{ ...gap, alertedAt, shoreAlertedAt }],
        crewClashState: {
          departures: [],
          clashes: new Map(),
          boatClashes: new Map(),
          crew: new Map(),
          divers: new Map(),
        },
      }),
    );
    return actions;
  };

  it("names when the owners were alerted, in the shop's zone", () => {
    const [row] = rows(new Date("2026-07-21T16:40:00Z"));
    expect(row?.detail?.replace(/\s+/gu, " ")).toMatch(/Owners alerted: Jul 21, 12:40 PM EDT\.$/);
  });

  // Dive-domain re-review #7: whoever opens Today knows the shore contact
  // heard too, so nobody rings them as if they had not.
  it("names the shore contact beside the owners when the shore copy went too", () => {
    const at = new Date("2026-07-21T16:40:00Z");
    const [row] = rows(at, at);
    expect(row?.detail?.replace(/\s+/gu, " ")).toMatch(
      /Owners and shore contact alerted: Jul 21, 12:40 PM EDT\.$/,
    );
  });

  it("names the shore contact alone when only the shore copy went", () => {
    const [row] = rows(null, new Date("2026-07-21T16:40:00Z"));
    expect(row?.detail?.replace(/\s+/gu, " ")).toMatch(
      /Shore contact alerted: Jul 21, 12:40 PM EDT\.$/,
    );
  });

  it("says nothing of an alert that has not gone", () => {
    const [row] = rows(null);
    expect(row?.detail).not.toContain("alerted");
  });
});

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

/**
 * DOM-H3 — the head count that says whether anybody is still in the water.
 *
 * These cases are deliberately adversarial, because the alarm has to survive an
 * empty checkpoint, a half-recorded one, an undo, a second dive, another
 * tenant, a boat that already went home — and, the two that used to break it:
 *
 * - a crew member tapping the only control that isn't "Boarded" **after a
 *   dive**, which means "not back yet, check again" and used to *close* the
 *   count instead of opening it;
 * - the divers who never showed up, who used to be counted as unaccounted-for
 *   in the water on every trip, until the red row meant nothing.
 */
describe("unclosed roll call (DOM-H3)", () => {
  describe("a diver who did not come back", () => {
    /**
     * The defect this whole suite is built around. On the swim step after dive
     * one the DM counts twelve back and one not, and taps the only control that
     * isn't "Boarded". `not_boarded` at an *after-dive* checkpoint means "did
     * not return to the boat" — the missing-diver event itself — and used to
     * read as "accounted for", closing the checkpoint, closing every later one
     * by carry-forward, clearing the board badge, and letting the trip age out
     * of the window with no residue at all.
     */
    it("raises the loudest row in the app when a diver is marked not back aboard", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const [index, bookingId] of bookingIds.entries()) {
        const outcome = await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: index === 0 ? "not_boarded" : "boarded",
          checkpoint: "after_dive_1",
        });
        expect(outcome.ok).toBe(true);
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_diver");

      expect(row).toBeDefined();
      expect(row?.kind).toBe("roll_call_missing_diver");
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("not back aboard");
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_1`,
      );
      // Every other diver has a result, so this is the only row on the boat —
      // and it must never be worded as an unfinished count.
      expect(rollCallRows(work, trip.id)).toHaveLength(1);
      // It outranks everything else on the queue, whatever else is due today.
      const [first] = sortStationRows(work.actions);
      expect(first?.id).toBe(row?.id);
    });

    it("does not let a later closed checkpoint bury it", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [missing, aboard] = bookingIds;
      if (!missing || !aboard) throw new Error("fixture bookings missing");
      // Dive one: one diver never came back. Dive two: the crew counted the one
      // diver they still had, so that checkpoint looks tidy. The missing diver
      // must still be the row — carry-forward must never turn an after-dive
      // `not_boarded` into "accounted for" at a later checkpoint.
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: missing,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      });
      for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: aboard,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint,
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_diver");
      expect(row?.detail).toContain("dive 1");
      expect(rollCallRow(work, trip.id, "after_dive_uncounted")).toBeUndefined();
    });

    /**
     * The rule `listUnaccountedForByTrip` and `homewardCheckpointGap` keep: the
     * latest after-dive checkpoint speaks for a seat (issue #2404). Missing after
     * dive 1 and counted aboard after dive 2 is back, so Today does not keep the
     * loudest row in the app up for a diver the crew have since counted. Still
     * missing after dive 2, or nobody has counted them since, stays the row.
     */
    it("lets a later 'back aboard' for the same diver settle an earlier 'not back'", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [wasMissing, other] = bookingIds;
      if (!wasMissing || !other) throw new Error("fixture bookings missing");
      const tap = (
        bookingId: string,
        checkpoint: "after_dive_1" | "after_dive_2",
        status: "boarded" | "not_boarded",
      ) =>
        recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status,
          checkpoint,
        });
      await tap(wasMissing, "after_dive_1", "not_boarded");
      await tap(other, "after_dive_1", "boarded");
      await tap(other, "after_dive_2", "boarded");

      // Nobody has counted them since: still the row.
      const stillMissing = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(stillMissing, trip.id, "missing_diver")).toBeDefined();

      await tap(wasMissing, "after_dive_2", "boarded");
      const back = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(back, trip.id, "missing_diver")).toBeUndefined();
      expect(rollCallRow(back, trip.id, "after_dive_uncounted")).toBeUndefined();
    });

    it("keeps saying so at a lower urgency once the trip is too old to settle on the dock", async () => {
      const { db, shop } = ctx;
      // Five days back: past the 48h dock-work window. This used to age to
      // nothing at all — the row left Today and the board with nothing anywhere
      // saying a count had never closed. A missing-diver signal that
      // self-clears is not a signal.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 24 * 5,
        divers: 2,
      });
      await boardAtDeparture(
        db,
        { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
        new Date(nowMs() - 24 * 5 * HOUR - 3 * HOUR),
      );
      const [missing] = bookingIds;
      if (!missing) throw new Error("fixture booking missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: missing,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(nowMs() - 24 * 5 * HOUR),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_diver");
      expect(row).toBeDefined();
      expect(row?.urgency).toBe("soon");
      // The residue clause, which only the stale copy carries — the fresh
      // missing-diver row ends at "after dive 1." Pinned on
      // this phrase rather than the whole sentence: the wording has been
      // trimmed once and may be again, and what must survive is that an aged
      // row still says the count never closed and names the manifest as where
      // to reconstruct it.
      expect(row?.detail).toContain("still marked not back aboard");
      expect(row?.detail).toContain("from the manifest");
      // Still the same kind: what happened did not become less serious, only
      // less settleable on the dock.
      expect(row?.kind).toBe("roll_call_missing_diver");
    });

    /**
     * The two surfaces must not disagree about who is still in the water, and
     * until 2026-08-15 nothing made that a property of the data. Both readers
     * order by `occurred_at` then `created_at` and keep the last row; both of
     * those tie exactly when two events are written inside one transaction
     * (`created_at` is `defaultNow()` — *transaction* time), so the winner was
     * whatever order the heap handed back, and it was free to differ between
     * two queries in one request.
     *
     * That is not hypothetical here: an offline batch syncs a device's queued
     * events together, carrying the device's own timestamps.
     *
     * This constructs the tie rather than trusting the clock's resolution to
     * avoid it — a correction from `boarded` to `not_boarded` appended second,
     * on one booking at one checkpoint. `seq` is the only key that separates
     * them, so if either reader loses it, one of these two assertions fails.
     */
    it("agrees with the manifest when two events tie on both timestamps", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -1,
        divers: 1,
        plannedDives: 1,
      });
      const bookingId = bookingIds[0];
      if (!bookingId) throw new Error("fixture produced no booking");
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const occurredAt = new Date(nowMs() - 30 * 60 * 1000);
      await db.transaction(async (tx) => {
        await tx.insert(rollCallEventsTable).values([
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "boarded" as const,
            checkpoint: "after_dive_1",
            source: "live" as const,
            occurredAt,
          },
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "not_boarded" as const,
            checkpoint: "after_dive_1",
            source: "live" as const,
            occurredAt,
          },
        ]);
      });

      // The tie is real, not assumed: assert both old keys are equal before
      // asserting anything about who wins. Without this the test could pass
      // because the clock happened to separate them.
      const written = await db
        .select({ createdAt: rollCallEventsTable.createdAt, seq: rollCallEventsTable.seq })
        .from(rollCallEventsTable)
        .where(
          and(
            eq(rollCallEventsTable.bookingId, bookingId),
            eq(rollCallEventsTable.checkpoint, "after_dive_1"),
          ),
        );
      expect(written).toHaveLength(2);
      const [first, second] = written;
      if (!first || !second) throw new Error("expected both events");
      expect(first.createdAt.getTime()).toBe(second.createdAt.getTime());
      expect(new Set(written.map((row) => row.seq)).size).toBe(2);

      const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
      expect(manifest?.divers.find((entry) => entry.bookingId === bookingId)?.rollCall?.state).toBe(
        "not_boarded",
      );

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, trip.id, "missing_diver")).toBeDefined();
    });
  });

  /**
   * Review 20260803, D1. The per-person crew half reached this function not at
   * all: a crew member tapped "not back aboard" against a divemaster, the
   * manifest went red with `crew_not_back_aboard` — its own comment calls it
   * "the loudest thing on this list" — and Today showed nothing, the schedule
   * board badged nothing, and neither the 48-hour dock-work chase nor the
   * 30-day residue a *diver* gets applied. On dive two the DM goes back down
   * for a lost weight belt and does not surface: this is that boat.
   */
  describe("a crew member who did not come back", () => {
    /** Roster `count` staff onto the trip and board them all at the dock. */
    async function crewAboard(
      db: ReturnType<typeof fileScopedShopContext>["db"],
      input: { shopId: string; tripId: string; count: number },
      occurredAt = new Date(nowMs() - 5 * HOUR),
    ) {
      const staff = (await listStaff(db, input.shopId)).slice(0, input.count);
      if (staff.length < input.count) throw new Error("seed has too few staff for this fixture");
      const personIds = staff.map((entry) => entry.person.id);
      await db
        .insert(tripAssignments)
        .values(personIds.map((personId) => ({ tripId: input.tripId, personId })));
      await db.insert(rollCallCrewEventsTable).values(
        personIds.map((personId) => ({
          shopId: input.shopId,
          tripId: input.tripId,
          personId,
          recordedByPersonId: personIds[0] ?? personId,
          status: "boarded" as const,
          checkpoint: "departure",
          occurredAt,
        })),
      );
      return personIds;
    }

    it("raises a crew row of its own when a named crew member is marked not back aboard", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      // Every diver came back from both dives — the diver half is closed, and
      // before this that was the whole of what Today looked at.
      for (const bookingId of bookingIds) {
        for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
          await recordRollCall(db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId,
            recordedByPersonId: staffId,
            status: "boarded",
            checkpoint,
          });
        }
      }
      const [dm, second] = await crewAboard(db, {
        shopId: shop.id,
        tripId: trip.id,
        count: 2,
      });
      if (!dm || !second) throw new Error("fixture crew missing");
      for (const personId of [dm, second]) {
        await recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          personId,
          recordedByPersonId: second,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      // Dive two: the DM went back down for a lost weight belt.
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: dm,
        recordedByPersonId: second,
        status: "not_boarded",
        checkpoint: "after_dive_2",
      });
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: second,
        recordedByPersonId: second,
        status: "boarded",
        checkpoint: "after_dive_2",
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_crew");
      expect(row).toBeDefined();
      expect(row?.kind).toBe("roll_call_missing_crew");
      // Same tone band and same urgency a diver gets — a crew member is not
      // less findable than a customer.
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("crew");
      expect(row?.detail).toContain("not back aboard");
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_2`,
      );
      // No diver row: the two halves are separate rows and the crew one is not
      // worded as a diver problem.
      expect(rollCallRow(work, trip.id, "missing_diver")).toBeUndefined();
      // And it leads the queue, exactly as the diver row does.
      const [first] = sortStationRows(work.actions);
      expect(first?.id).toBe(row?.id);
    });

    it("keeps saying so as residue, on the same schedule a diver's row ages by", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 24 * 5,
        divers: 2,
      });
      await boardAtDeparture(
        db,
        { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
        new Date(nowMs() - 24 * 5 * HOUR - 3 * HOUR),
      );
      const [dm] = await crewAboard(
        db,
        { shopId: shop.id, tripId: trip.id, count: 1 },
        new Date(nowMs() - 24 * 5 * HOUR - 3 * HOUR),
      );
      if (!dm) throw new Error("fixture crew missing");
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: dm,
        recordedByPersonId: dm,
        status: "not_boarded",
        checkpoint: "after_dive_1",
        occurredAt: new Date(nowMs() - 24 * 5 * HOUR),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "missing_crew");
      expect(row).toBeDefined();
      expect(row?.urgency).toBe("soon");
      // Same residue clause as the diver half above, and same reason for
      // matching on it rather than the sentence.
      expect(row?.detail).toContain("from the manifest");
      expect(row?.kind).toBe("roll_call_missing_crew");
    });

    it("raises an unfinished crew count, and stays silent for a shop that never taps one", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      // Two crew boarded at the dock; nobody counted either of them after the
      // dive. That is the crew twin of `after_dive_uncounted`.
      await crewAboard(db, { shopId: shop.id, tripId: trip.id, count: 2 });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "crew_uncounted");
      expect(row?.kind).toBe("roll_call_crew_unfinished");
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("2 of 2 crew");

      // The population rule is what keeps this usable: a shop that has never
      // tapped a crew roll call has no crew subjects, so it raises nothing at
      // all rather than a danger-toned row on every trip it has ever run.
      const quiet = await returnedTrip(db, shop.id, {
        endedHoursAgo: 3,
        divers: 2,
        title: "Returned Two-Tank — no crew roll call",
      });
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: quiet.trip.id,
        staffId,
        bookingIds: quiet.bookingIds,
      });
      for (const bookingId of quiet.bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: quiet.trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      await db.insert(tripAssignments).values({ tripId: quiet.trip.id, personId: staffId });
      const quietWork = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(quietWork, quiet.trip.id)).toHaveLength(0);
    });
  });

  describe("an after-dive count nobody finished", () => {
    it("alarms when a diver who boarded has no result at the checkpoint", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds.slice(0, 2)) {
        const outcome = await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
        expect(outcome.ok).toBe(true);
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      expect(row?.kind).toBe("roll_call_unfinished");
      expect(row?.urgency).toBe("imminent");
      expect(row?.dueAt?.getTime()).toBe(trip.endsAt.getTime());
      expect(row?.detail).toContain("1 of 3 people");
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_1`,
      );
      // The boat is gone from every forward-looking surface — which is precisely
      // why this row had to come from its own backwards query.
      expect(work.departures.some((departure) => departure.tripId === trip.id)).toBe(false);
    });

    it("goes quiet once every diver who boarded is back aboard", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      // "Accounted for" after a dive means one thing and one thing only: back on
      // the boat. There is no other way to close this count.
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("re-alarms when a diver is cleared back to awaiting", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }
      expect(
        rollCallRows(await getTodayWork(db, shop.id, shop.slug, shop.timezone), trip.id),
      ).toEqual([]);

      // A `cleared` event is an undo — the diver reads as awaiting again on the
      // manifest, so the count is open again here too. Roll-call history is
      // append-only, so the older `boarded` row is still in the table.
      const [undone] = bookingIds;
      if (!undone) throw new Error("fixture booking missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: undone,
        recordedByPersonId: staffId,
        status: "cleared",
        checkpoint: "after_dive_1",
        occurredAt: new Date(nowMs() + 1000),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, trip.id, "after_dive_uncounted")?.detail).toContain("1 of 2 people");
    });

    it("alarms on the second dive of a two-dive trip whose first dive is complete", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 3,
        divers: 2,
        plannedDives: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      // Reported at the earliest dive still open, and pointed straight at it.
      expect(row?.href).toBe(
        `/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_2`,
      );
      expect(row?.detail).toContain("dive 2");
    });

    it("does not count a diver who never left the dock", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
        plannedDives: 2,
      });
      const [ashore, aboard] = bookingIds;
      if (!ashore || !aboard) throw new Error("fixture bookings missing");
      // `not_boarded` at *departure* is the benign half of the word: this diver
      // never got on the boat, so no after-dive count is waiting on them.
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        staffId,
        bookingIds: [aboard],
      });
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: ashore,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "departure",
      });
      for (const checkpoint of ["after_dive_1", "after_dive_2"] as const) {
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: aboard,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint,
        });
      }

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("drops a canceled booking from the count instead of alarming forever", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [counted, pulled] = bookingIds;
      if (!counted || !pulled) throw new Error("fixture bookings missing");
      // The second diver's seat was cancelled at the dock, before the boat
      // left. Once it has (its time, a stage past Boarding, or any after-dive
      // mark), a diver marked aboard cannot be removed (H-20261015-aboard-diver-removal-at), so the cancel
      // comes before the first after-dive mark — they are off the manifest's
      // roster, so there is nobody left uncounted.
      const atTheDock = new Date(trip.startsAt.getTime() - 10 * 60 * 1000);
      expect(await cancelBooking(db, shop.id, pulled, { now: atTheDock })).toMatchObject({
        ok: true,
      });
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: counted,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "after_dive_1",
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("keeps chasing a boat that came back yesterday", async () => {
      const { db, shop } = ctx;
      // 30 hours back is a different calendar day in every timezone, so this can
      // never be reached by the shop's own "today" filter — the exact case the
      // forward window drops on the floor.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 30,
        divers: 4,
      });
      await boardAtDeparture(
        db,
        { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
        new Date(nowMs() - 33 * HOUR),
      );

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const row = rollCallRow(work, trip.id, "after_dive_uncounted");
      expect(row?.detail).toContain("4 of 4 people");
      expect(row?.urgency).toBe("imminent");
    });
  });
});
