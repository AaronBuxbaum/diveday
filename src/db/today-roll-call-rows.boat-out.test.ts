import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { sortStationRows } from "@/lib/today";
import { shopDayBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { recordRollCall } from "./manifests";
import {
  createCertification,
  listTripReadiness,
  reviewCertification,
  unreviewCertification,
  upsertTripRequirements,
} from "./readiness";
import {
  bookings as bookingsTable,
  rollCallEvents as rollCallEventsTable,
  trips as tripsTable,
} from "./schema";
import { countBlockedDiversNextBoatDay, getTodayWork } from "./today";
import {
  afterDiveRow,
  boardAtDeparture,
  HOUR,
  returnedTrip,
  rollCallRow,
  rollCallRows,
} from "./today-roll-call-test-fixtures";
import { recordTripStage } from "./trip-stages";
import { listStaff } from "./trips";

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

/** DOM-H3, continued from `today-roll-call-rows.test.ts`: a boat still out, the dock count, and the bounds. */
describe("unclosed roll call (DOM-H3), the boat out", () => {
  describe("a boat that is still out", () => {
    it("says nothing about a checkpoint that has not happened yet", async () => {
      const { db, shop } = ctx;
      // Ends two hours from now, with nothing recorded after departure: the
      // dive-one count is not unfinished, it has not been taken. Alarming here
      // would be guessing at a schedule the app does not hold.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });

    it("alarms immediately on a count that was started and abandoned", async () => {
      const { db, shop } = ctx;
      // The case that used to cost three hours of silence: on a four-hour
      // two-tank, dive one's count runs about ninety minutes in. The DM counts
      // two of three and gets pulled away. The boat is still on the mooring and
      // the third diver is still findable — but nothing said anything until
      // `endsAt`.
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      for (const bookingId of bookingIds.slice(0, 2)) {
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
      expect(row?.urgency).toBe("imminent");
      expect(row?.detail).toContain("Boat is out");
      expect(row?.detail).toContain("1 of 3 people");
    });

    it("raises a missing diver while the boat is still on the site", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: -2,
        divers: 2,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      const [missing, aboard] = bookingIds;
      if (!missing || !aboard) throw new Error("fixture bookings missing");
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: missing,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      });
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: aboard,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "after_dive_1",
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, trip.id, "missing_diver")?.urgency).toBe("imminent");
    });

    /**
     * **A blocked diver aboard stays on the list until the boat is home**
     * (issue #2064). The readiness rows behind the "Aboard" row come from the
     * forward-looking horizon, which drops a departure an hour after it sails,
     * so a diver who boarded on a medical hold vanished while the boat was
     * still out and they may have been in the water. Ashore blockers for a boat
     * that has gone stay gone: nothing is left to stop.
     */
    describe("a blocked diver who boarded", () => {
      async function sailedNinetyMinutesAgo() {
        const { db, shop } = ctx;
        // Four hours long, so it sailed ninety minutes ago and is out for two
        // and a half more: well past the horizon's one-hour buffer.
        const fixture = await returnedTrip(db, shop.id, {
          endedHoursAgo: -2.5,
          divers: 2,
          title: "Blocked Aboard — Molasses",
        });
        const [boarded, ashore] = fixture.bookingIds;
        if (!boarded || !ashore) throw new Error("fixture bookings missing");
        await boardAtDeparture(
          db,
          {
            shopId: shop.id,
            tripId: fixture.trip.id,
            staffId: fixture.staffId,
            bookingIds: [boarded],
          },
          new Date(fixture.trip.startsAt.getTime() + 5 * 60 * 1000),
        );
        return { ...fixture, boarded, ashore };
      }

      const rowsFor = (work: Awaited<ReturnType<typeof getTodayWork>>, tripId: string) =>
        work.actions.filter(
          (action) => action.departure?.tripId === tripId && !action.id.startsWith("roll-call:"),
        );

      it("keeps the Aboard row while the boat is still out, and only that row", async () => {
        const { db, shop } = ctx;
        const { trip, boarded } = await sailedNinetyMinutesAgo();
        // The fixture trip has no requirements row, so both seats read blocked:
        // the premise, checked rather than assumed.
        const readiness = await listTripReadiness(db, shop.id, trip.id);
        expect(readiness.every((row) => row.readiness.status === "blocked")).toBe(true);

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        const rows = rowsFor(work, trip.id);
        expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
        expect(rows[0]?.id).toContain(boarded);
        // The home files it into Needs you rather than under the week's count.
        expect(work.outTripIds).toContain(trip.id);
        // The departure is not a live station again: the closing state owns it.
        expect(work.departures.some((departure) => departure.tripId === trip.id)).toBe(false);
      });

      it("counts the diver aboard in the nav badge until the boat is home", async () => {
        const { db, shop } = ctx;
        const { trip, staffId } = await sailedNinetyMinutesAgo();
        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        const badge = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone);
        // The one boarded diver, not the one left ashore on a boat that has gone.
        expect(work.blockedAboard).toBeGreaterThanOrEqual(1);
        expect(badge.aboard).toBe(work.blockedAboard);
        expect(badge.total).toBe(badge.onDay + badge.aboard);

        await recordTripStage(db, {
          shopId: shop.id,
          tripId: trip.id,
          stage: "home",
          recordedByPersonId: staffId,
          recordedAt: nowDate(),
        });
        const home = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone);
        expect(home.aboard).toBe(badge.aboard - 1);
      });

      it("drops the row once the crew says the boat is home", async () => {
        const { db, shop } = ctx;
        const { trip, staffId } = await sailedNinetyMinutesAgo();
        const recorded = await recordTripStage(db, {
          shopId: shop.id,
          tripId: trip.id,
          stage: "home",
          recordedByPersonId: staffId,
          recordedAt: nowDate(),
        });
        expect(recorded.ok).toBe(true);

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).not.toContain(trip.id);
      });

      it("drops the row once the boat is back by the clock", async () => {
        const { db, shop } = ctx;
        // Tied up two hours ago, past the return buffer, with nobody tapping.
        const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
          endedHoursAgo: 2,
          divers: 1,
          title: "Blocked Aboard, home — Molasses",
        });
        await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).not.toContain(trip.id);
      });

      it("keeps a night boat tapped Underway out past midnight, as long as its untapped twin", async () => {
        // A crew's tap must never finish a departure sooner than silence would
        // (dive-domain review of UX batch 1): back at 23:30, still inside the
        // hour's buffer at 00:05, so the diver aboard on a hold stays listed.
        const { db, shop } = ctx;
        const midnight = shopDayBounds(new Date(nowMs()), shop.timezone).to.getTime();
        const endsAt = midnight - 30 * 60 * 1000;
        const fixture = await returnedTrip(db, shop.id, {
          endedHoursAgo: (nowMs() - endsAt) / HOUR,
          divers: 1,
          title: "Blocked Aboard, night boat — Molasses",
        });
        const { trip, bookingIds, staffId } = fixture;
        await boardAtDeparture(
          db,
          { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
          new Date(trip.startsAt.getTime() + 5 * 60 * 1000),
        );
        const recorded = await recordTripStage(db, {
          shopId: shop.id,
          tripId: trip.id,
          stage: "underway",
          recordedByPersonId: staffId,
          recordedAt: new Date(trip.startsAt.getTime() + HOUR),
        });
        expect(recorded.ok).toBe(true);

        const afterMidnight = new Date(midnight + 5 * 60 * 1000);
        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, afterMidnight);
        expect(rowsFor(work, trip.id).map((row) => row.kind)).toEqual(["blocked_aboard"]);
        expect(work.outTripIds).toContain(trip.id);

        // Both readers let go together once the hour past its return is over.
        const later = new Date(endsAt + HOUR);
        const home = await getTodayWork(db, shop.id, shop.slug, shop.timezone, later);
        expect(rowsFor(home, trip.id)).toEqual([]);
        expect(home.outTripIds).not.toContain(trip.id);
      });

      it("keeps a two-day course out on day two after its crew said home on day one", async () => {
        // `starts_at`/`ends_at` bound the whole run: a `home` after day one is
        // the crew tying up for the night, and only one from the last day ends it.
        const { db, shop } = ctx;
        const dayTwo = shopDayBounds(new Date(nowMs()), shop.timezone).from.getTime();
        const [course] = await db
          .insert(tripsTable)
          .values({
            shopId: shop.id,
            title: "Open Water weekend — Molasses",
            startsAt: new Date(dayTwo - 16 * HOUR),
            endsAt: new Date(dayTwo + 16 * HOUR),
            capacity: 8,
            plannedDives: 2,
            priceCents: 45000,
          })
          .returning();
        if (!course) throw new Error("fixture trip insert returned no row");
        const [staff] = await listStaff(db, shop.id);
        if (!staff) throw new Error("seed staff missing");
        const tap = (recordedAt: Date) =>
          recordTripStage(db, {
            shopId: shop.id,
            tripId: course.id,
            stage: "home",
            recordedByPersonId: staff.person.id,
            recordedAt,
          });
        expect((await tap(new Date(dayTwo - 7 * HOUR))).ok).toBe(true);

        const dayTwoMorning = new Date(dayTwo + 10 * HOUR);
        const out = await getTodayWork(db, shop.id, shop.slug, shop.timezone, dayTwoMorning);
        expect(out.outTripIds).toContain(course.id);

        expect((await tap(new Date(dayTwo + 15 * HOUR))).ok).toBe(true);
        const home = await getTodayWork(
          db,
          shop.id,
          shop.slug,
          shop.timezone,
          new Date(dayTwo + 15.5 * HOUR),
        );
        expect(home.outTripIds).not.toContain(course.id);
      });

      it("drops the row once the crew count the diver back aboard after the last dive", async () => {
        // The boat is still out by the clock, but the diver this row is about
        // is out of the water: the evening's "All boats are home" line reads
        // the same count, and the two must not disagree.
        const { db, shop } = ctx;
        const { trip, boarded, staffId } = await sailedNinetyMinutesAgo();
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: boarded,
          recordedByPersonId: staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).toContain(trip.id);
      });

      it("keeps the row while a dive is still to come", async () => {
        // Counted back after dive one of two is a surface interval, not home.
        const { db, shop } = ctx;
        const fixture = await returnedTrip(db, shop.id, {
          endedHoursAgo: -2.5,
          divers: 1,
          plannedDives: 2,
          title: "Blocked Aboard, two tanks — Molasses",
        });
        const [boarded] = fixture.bookingIds;
        if (!boarded) throw new Error("fixture booking missing");
        await boardAtDeparture(
          db,
          {
            shopId: shop.id,
            tripId: fixture.trip.id,
            staffId: fixture.staffId,
            bookingIds: [boarded],
          },
          new Date(fixture.trip.startsAt.getTime() + 5 * 60 * 1000),
        );
        await recordRollCall(db, {
          shopId: shop.id,
          tripId: fixture.trip.id,
          bookingId: boarded,
          recordedByPersonId: fixture.staffId,
          status: "boarded",
          checkpoint: "after_dive_1",
        });

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, fixture.trip.id).map((row) => row.kind)).toEqual(["blocked_aboard"]);
      });

      /**
       * **Boarded after the dock count** (issue #2142). A two-site day where a
       * diver is picked up at the second site, or rides out on a chase boat:
       * the crew's first word about them is `boarded` at `after_dive_1`, and
       * their dock result is empty or `not_boarded`. They are aboard, on a
       * medical hold, while the boat is out — the row this describe exists for.
       */
      describe("first counted aboard after the dock count", () => {
        async function insertRollCall(input: {
          tripId: string;
          bookingId: string;
          staffId: string;
          status: "boarded" | "not_boarded" | "cleared";
          checkpoint: string;
          occurredAt?: Date;
        }) {
          await ctx.db.insert(rollCallEventsTable).values({
            shopId: ctx.shop.id,
            tripId: input.tripId,
            bookingId: input.bookingId,
            recordedByPersonId: input.staffId,
            status: input.status,
            checkpoint: input.checkpoint,
            source: "live",
            occurredAt: input.occurredAt ?? nowDate(),
          });
        }

        async function twoSiteDay(dockResult: "none" | "not_boarded", endedHoursAgo = -2.5) {
          const { db, shop } = ctx;
          const fixture = await returnedTrip(db, shop.id, {
            endedHoursAgo,
            divers: 1,
            plannedDives: 2,
            title: "Blocked Aboard, second site — Molasses",
          });
          const [pickedUp] = fixture.bookingIds;
          if (!pickedUp) throw new Error("fixture booking missing");
          const base = { tripId: fixture.trip.id, bookingId: pickedUp, staffId: fixture.staffId };
          if (dockResult === "not_boarded") {
            await insertRollCall({
              ...base,
              status: "not_boarded",
              checkpoint: "departure",
              occurredAt: new Date(fixture.trip.startsAt.getTime() + 5 * 60 * 1000),
            });
          }
          await insertRollCall({ ...base, status: "boarded", checkpoint: "after_dive_1" });
          return { ...fixture, pickedUp };
        }

        it("keeps the Aboard row for a diver with no dock result", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("none");
          const readiness = await listTripReadiness(db, shop.id, trip.id);
          expect(readiness.every((row) => row.readiness.status === "blocked")).toBe(true);

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          const rows = rowsFor(work, trip.id);
          expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
          expect(rows[0]?.id).toContain(pickedUp);
          expect(work.outTripIds).toContain(trip.id);
          const badge = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone);
          expect(work.blockedAboard).toBeGreaterThanOrEqual(1);
          expect(badge.aboard).toBe(work.blockedAboard);
        });

        it("keeps the Aboard row for a diver marked not boarded at the dock", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("not_boarded");

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          const rows = rowsFor(work, trip.id);
          expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
          expect(rows[0]?.id).toContain(pickedUp);
        });

        it("keeps a cancelled departure out when its only boarding came after the dock", async () => {
          const { db, shop } = ctx;
          const { trip } = await twoSiteDay("none");
          await db
            .update(tripsTable)
            .set({ status: "cancelled" })
            .where(eq(tripsTable.id, trip.id));

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, trip.id).map((row) => row.kind)).toEqual(["blocked_aboard"]);
          expect(work.outTripIds).toContain(trip.id);
        });

        it("drops the row when the after-dive boarding is undone", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp, staffId } = await twoSiteDay("none");
          await insertRollCall({
            tripId: trip.id,
            bookingId: pickedUp,
            staffId,
            status: "cleared",
            checkpoint: "after_dive_1",
            occurredAt: new Date(nowMs() + 1000),
          });

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, trip.id)).toEqual([]);
        });

        it("drops the row for a booking cancelled after it boarded", async () => {
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("none");
          await db
            .update(bookingsTable)
            .set({ status: "cancelled" })
            .where(eq(bookingsTable.id, pickedUp));

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, trip.id)).toEqual([]);
        });

        it("never reads an after-dive not boarded as aboard", async () => {
          // That word is the missing-diver row's, which already exists; the
          // Aboard row stays about somebody the crew counted onto the boat.
          const { db, shop } = ctx;
          const fixture = await returnedTrip(db, shop.id, {
            endedHoursAgo: -2.5,
            divers: 1,
            plannedDives: 2,
            title: "Blocked, never aboard — Molasses",
          });
          const [diver] = fixture.bookingIds;
          if (!diver) throw new Error("fixture booking missing");
          await insertRollCall({
            tripId: fixture.trip.id,
            bookingId: diver,
            staffId: fixture.staffId,
            status: "not_boarded",
            checkpoint: "after_dive_1",
          });

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(rowsFor(work, fixture.trip.id).map((row) => row.kind)).not.toContain(
            "blocked_aboard",
          );
        });

        it("marks the in-window row Aboard by the same rule", async () => {
          // Sailed half an hour ago, so still a live station: the ordinary
          // path draws the row, and it must agree with the boats-out path.
          const { db, shop } = ctx;
          const { trip, pickedUp } = await twoSiteDay("none", -3.5);

          const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
          expect(work.departures.some((departure) => departure.tripId === trip.id)).toBe(true);
          const kinds = rowsFor(work, trip.id)
            .filter((row) => row.id.includes(pickedUp))
            .map((row) => row.kind);
          expect(kinds).toEqual(["blocked_aboard"]);
        });
      });

      it("keeps the Aboard row when the desk cancels the departure after it boarded", async () => {
        // The roll call outranks a later desk word, as for the fly-safe reader
        // (#1836): the boarding was recorded before the cancel and the diver is
        // on that boat whatever the status column now says.
        const { db, shop } = ctx;
        const { trip, boarded } = await sailedNinetyMinutesAgo();
        await db.update(tripsTable).set({ status: "cancelled" }).where(eq(tripsTable.id, trip.id));

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        const rows = rowsFor(work, trip.id);
        expect(rows.map((row) => row.kind)).toEqual(["blocked_aboard"]);
        expect(rows[0]?.id).toContain(boarded);
        expect(work.outTripIds).toContain(trip.id);
      });

      it("says nothing about a cancelled departure nobody boarded", async () => {
        const { db, shop } = ctx;
        const { trip } = await returnedTrip(db, shop.id, {
          endedHoursAgo: -2.5,
          divers: 2,
          title: "Blown out — Molasses",
        });
        await db.update(tripsTable).set({ status: "cancelled" }).where(eq(tripsTable.id, trip.id));

        const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
        expect(rowsFor(work, trip.id)).toEqual([]);
        expect(work.outTripIds).not.toContain(trip.id);
      });
    });
  });

  describe("the dock count, which is paperwork", () => {
    /**
     * Alarm fatigue is a safety property. Crews tap "Boarded" for the people in
     * front of them and never touch the two who didn't show — there is no bulk
     * action, and the counter's no-show mark (`markBookingNoShow`,
     * src/db/no-show.ts) writes `bookings.status`, never a `roll_call_events`
     * row, so a walk-away arrives here with no result at any checkpoint whether
     * or not the desk released their seat. Counting those two as
     * unaccounted-for after every dive raised a danger-toned row on most real
     * trips, and within a fortnight the red row is wallpaper.
     */
    it("does not treat a walk-away as somebody left in the water", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 4,
      });
      const sailed = bookingIds.slice(0, 2);
      // Two divers never showed and were never tapped at all. The two who did
      // sail were boarded and counted back.
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        staffId,
        bookingIds: sailed,
      });
      for (const bookingId of sailed) {
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
      // Nobody was ever unaccounted for in the water, so no after-dive row.
      expect(afterDiveRow(work, trip.id)).toBeUndefined();
      // The unfinished dock count is still stated — quietly, in its own words,
      // and never with the wording of a diver who may still be down.
      const row = rollCallRow(work, trip.id, "departure_uncounted");
      expect(row?.kind).toBe("roll_call_departure_open");
      expect(row?.urgency).toBe("now");
      expect(row?.detail).toContain("2 of 4 people");
      // Its own words, never the after-dive ones: nobody here was ever
      // unaccounted for after a dive.
      expect(row?.detail).toMatch(/dock count/i);
      expect(row?.detail).not.toContain("not back aboard");
      expect(row?.href).toBe(`/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=departure`);
    });

    it("sorts below every after-dive row, so it can never lead the queue", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      // One diver was never tapped at the dock; the two who boarded were never
      // counted back. Both rows exist — the after-dive one must lead.
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        staffId,
        bookingIds: bookingIds.slice(0, 2),
      });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const rows = rollCallRows(work, trip.id);
      expect(rows.map((row) => row.kind).sort()).toEqual([
        "roll_call_departure_open",
        "roll_call_unfinished",
      ]);
      const [first] = sortStationRows(work.actions);
      expect(first?.kind).toBe("roll_call_unfinished");
    });

    it("calls a trip with no roll call at all what it is, at a lower severity", async () => {
      const { db, shop } = ctx;
      // Not a lost diver: a shop that isn't using the feature. Reading it as
      // fine would be a false all-clear, so it is still said — just not in the
      // words of a person who may be in the water.
      const { trip } = await returnedTrip(db, shop.id, { endedHoursAgo: 2, divers: 3 });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const rows = rollCallRows(work, trip.id);
      expect(rows.map((row) => row.kind)).toEqual(["roll_call_not_started"]);
      const [row] = rows;
      expect(row?.urgency).toBe("now");
      expect(row?.detail).toContain("No roll call recorded");
      expect(row?.detail).not.toContain("not back aboard");
      expect(row?.href).toBe(`/shop/${shop.slug}/trips/${trip.id}/manifest?checkpoint=departure`);
    });

    /**
     * Issue #2251. The roll call counts every seat aboard, snorkelers and
     * riders included (ADR 20261007-participant-types), so its sentences say
     * people: a rider not accounted for is not "a diver not back aboard".
     */
    it("says people, not divers, when the count covers a snorkeler and a rider", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      const [diverSeat, snorkelerSeat, riderSeat] = bookingIds;
      if (!diverSeat || !snorkelerSeat || !riderSeat) throw new Error("three seats expected");
      await db
        .update(bookingsTable)
        .set({ participantType: "snorkeler" })
        .where(eq(bookingsTable.id, snorkelerSeat));
      await db
        .update(bookingsTable)
        .set({ participantType: "rider" })
        .where(eq(bookingsTable.id, riderSeat));
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });
      await db.insert(rollCallEventsTable).values(
        bookingIds.map((bookingId) => ({
          shopId: shop.id,
          tripId: trip.id,
          bookingId,
          recordedByPersonId: staffId,
          status: bookingId === riderSeat ? ("not_boarded" as const) : ("boarded" as const),
          checkpoint: "after_dive_1",
          source: "live" as const,
          occurredAt: new Date(nowMs() - 3 * HOUR),
        })),
      );

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const [row] = rollCallRows(work, trip.id);
      expect(row?.kind).toBe("roll_call_missing_diver");
      expect(row?.detail).toMatch(/^1 of 3 people is not back aboard after dive 1\./);
    });

    it("counts people on a mixed boat with no roll call at all", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds } = await returnedTrip(db, shop.id, { endedHoursAgo: 2, divers: 2 });
      const [, riderSeat] = bookingIds;
      if (!riderSeat) throw new Error("two seats expected");
      await db
        .update(bookingsTable)
        .set({ participantType: "rider" })
        .where(eq(bookingsTable.id, riderSeat));

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const [row] = rollCallRows(work, trip.id);
      expect(row?.detail).toBe("No roll call recorded for 2 people.");
    });

    it("stops chasing the dock count once the trip is older than the lookback", async () => {
      const { db, shop } = ctx;
      // Paperwork ages out; the after-dive signal above does not. Carrying a
      // month of missing dock counts would bury the rows that matter.
      const { trip } = await returnedTrip(db, shop.id, { endedHoursAgo: 24 * 5, divers: 3 });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRows(work, trip.id)).toEqual([]);
    });
  });

  describe("bounds", () => {
    /**
     * The cap used to be `limit(20)` over `asc(endsAt)`, applied *before* any
     * openness test: a busy four-boat operation with more than twenty trips in
     * the window kept the twenty oldest — mostly already closed — and silently
     * dropped the boat that had just tied up with an open count.
     */
    it("never drops the boat that just tied up behind older, closed ones", async () => {
      const { db, shop } = ctx;
      // Twenty-four earlier boats, all closed, then the one that matters.
      for (let index = 0; index < 24; index++) {
        const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
          endedHoursAgo: 40 - index,
          divers: 1,
          title: `Closed boat ${index}`,
        });
        await boardAtDeparture(
          db,
          { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
          new Date(nowMs() - (44 - index) * HOUR),
        );
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
      }
      const {
        trip: newest,
        bookingIds,
        staffId,
      } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 1,
        divers: 3,
        title: "The 16:30 boat",
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: newest.id, staffId, bookingIds });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      expect(rollCallRow(work, newest.id, "after_dive_uncounted")?.detail).toContain(
        "3 of 3 people",
      );
    });

    it("is tenant-safe: another shop's queue never sees this boat", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const otherWork = await getTodayWork(
        db,
        "00000000-0000-4000-8000-000000000000",
        "other-shop",
        shop.timezone,
      );

      expect(rollCallRows(otherWork, trip.id)).toEqual([]);
      expect(otherWork.actions.every((action) => !action.kind.startsWith("roll_call_"))).toBe(true);
    });

    it("points the row inside this shop and leads the whole queue", async () => {
      const { db, shop } = ctx;
      const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
        endedHoursAgo: 2,
        divers: 3,
      });
      await boardAtDeparture(db, { shopId: shop.id, tripId: trip.id, staffId, bookingIds });

      const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
      const [first] = sortStationRows(work.actions);

      expect(first?.id).toBe(`roll-call:${trip.id}:after_dive_uncounted:after_dive_1`);
      expect(first?.href.startsWith(`/shop/${shop.slug}/`)).toBe(true);
    });
  });
});

/**
 * **An undone card review reaches a diver already on the boat** (dive-domain
 * review of the test-suite layer 1). A staffer verified the card, the diver
 * boarded on it, and the staffer then taps Undo: the diver is aboard with a
 * certification nobody has checked, and Today has to say so while the boat is
 * out, not only on their next departure.
 */
describe("a card review undone after the diver boarded", () => {
  it("raises a blocked_aboard certification row while the boat is out", async () => {
    const { db, shop } = ctx;
    const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
      endedHoursAgo: -2.5,
      divers: 1,
      title: "Undone Review — Molasses",
    });
    const [bookingId] = bookingIds;
    if (!bookingId) throw new Error("fixture booking missing");
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: trip.id,
      requiresWaiver: false,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    const [seat] = await db
      .select({ personId: bookingsTable.personId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    if (!seat) throw new Error("fixture seat missing");
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: seat.personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-ABOARD",
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    await boardAtDeparture(
      db,
      { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
      new Date(trip.startsAt.getTime() + 5 * 60 * 1000),
    );
    const aboardRows = async () =>
      (await getTodayWork(db, shop.id, shop.slug, shop.timezone)).actions.filter(
        (action) => action.departure?.tripId === trip.id && action.kind === "blocked_aboard",
      );
    // Cleared on the card: nothing to say about them aboard.
    expect(await aboardRows()).toEqual([]);

    expect(await unreviewCertification(db, { shopId: shop.id, certificationId: card.id })).toEqual({
      ok: true,
    });

    const rows = await aboardRows();
    expect(rows.map((row) => row.id)).toEqual([`blocker:${bookingId}:certification_pending`]);
  });
});
