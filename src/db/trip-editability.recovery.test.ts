import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { readDepartureStage } from "../features/trip-stages/store";
import {
  boardAtDeparture,
  returnedTrip,
} from "../test/substrate-fixtures/db/roll-call-test-fixtures";
import {
  getTripManifest,
  listUnaccountedForByTrip,
  recordCrewRollCall,
  recordRollCall,
} from "./manifests";
import { tripStageEvents } from "./schema";
import { tripDetailsAreEditable } from "./trip-editability";
import { changeTripCrewOutcome, getTripCrewIds } from "./trips";

const ctx = fileScopedShopContext();
describe("a closed definition never closes safety recovery", () => {
  it.each([true, false])(
    "allows an after-dive missing-diver correction (explicit Home: %s)",
    async (explicitHome) => {
      const { db, shop } = ctx;
      const made = await returnedTrip(db, shop.id, {
        endedHoursAgo: explicitHome ? -2 : 2,
        divers: 1,
      });
      await boardAtDeparture(db, {
        shopId: shop.id,
        tripId: made.trip.id,
        staffId: made.staffId,
        bookingIds: made.bookingIds,
      });
      const input = {
        shopId: shop.id,
        tripId: made.trip.id,
        bookingId: made.bookingIds[0],
        recordedByPersonId: made.staffId,
        checkpoint: "after_dive_1" as const,
      };
      expect(await recordRollCall(db, { ...input, status: "not_boarded" })).toMatchObject({
        ok: true,
      });
      if (explicitHome) {
        await db.insert(tripStageEvents).values({
          shopId: shop.id,
          tripId: made.trip.id,
          stage: "home",
          recordedByPersonId: made.staffId,
          recordedAt: nowDate(),
        });
      }
      expect(await tripDetailsAreEditable(db, shop.id, made.trip.id)).toBe(false);
      expect(
        (await listUnaccountedForByTrip(db, shop.id, [made.trip.id]))
          .get(made.trip.id)
          ?.has(input.bookingId),
      ).toBe(true);
      // Staff read the missing statement before deliberately correcting it.
      // A later clock alone must not turn an unobserved mark into a correction.
      const visible = await getTripManifest(db, shop.id, made.trip.id, "after_dive_1");
      const basis = visible?.divers.find(
        (row) => row.bookingId === input.bookingId,
      )?.rollCallContext;
      expect(basis?.conflict).toBe(false);
      expect(basis?.observedEvidenceIds).toHaveLength(1);
      if (!basis) throw new Error("expected the visible missing statement");
      advanceClock();
      expect(
        await recordRollCall(db, {
          ...input,
          status: "boarded",
          observedEvidenceIds: basis.observedEvidenceIds,
          meetingDay: basis.meetingDay,
        }),
      ).toMatchObject({ ok: true });
      expect(
        (await listUnaccountedForByTrip(db, shop.id, [made.trip.id])).get(made.trip.id)?.size ?? 0,
      ).toBe(0);
    },
  );
});

it.each([true, false])(
  "can add omitted actual crew after plan closure (explicit Home: %s)",
  async (explicitHome) => {
    const { db, shop } = ctx;
    const made = await returnedTrip(db, shop.id, {
      endedHoursAgo: explicitHome ? -2 : 2,
      divers: 1,
    });
    if (explicitHome)
      await db.insert(tripStageEvents).values({
        shopId: shop.id,
        tripId: made.trip.id,
        stage: "home",
        recordedByPersonId: made.staffId,
        recordedAt: nowDate(),
      });
    expect(
      await changeTripCrewOutcome(db, shop.id, made.trip.id, {
        operation: "assign",
        personId: made.staffId,
      }),
    ).toEqual({ ok: true });
    expect(await getTripCrewIds(db, shop.id, made.trip.id)).toContain(made.staffId);
    expect(
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: made.trip.id,
        personId: made.staffId,
        recordedByPersonId: made.staffId,
        checkpoint: "after_dive_1",
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
  },
);

it("keeps an unfinished started after-dive count live while omitted crew are corrected", async () => {
  const { db, shop } = ctx;
  const made = await returnedTrip(db, shop.id, { endedHoursAgo: 2, divers: 2 });
  await boardAtDeparture(db, {
    shopId: shop.id,
    tripId: made.trip.id,
    staffId: made.staffId,
    bookingIds: made.bookingIds,
  });
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: made.trip.id,
      bookingId: made.bookingIds[0],
      recordedByPersonId: made.staffId,
      checkpoint: "after_dive_1",
      status: "boarded",
    }),
  ).toMatchObject({ ok: true });
  expect(
    (
      await readDepartureStage(db, shop.id, made.trip.id, {
        ...made.trip,
        now: nowDate(),
        timeZone: shop.timezone,
        stage: null,
        cancelled: false,
      })
    ).finished,
  ).toBe(false);
  expect(
    await changeTripCrewOutcome(db, shop.id, made.trip.id, {
      operation: "assign",
      personId: made.staffId,
    }),
  ).toEqual({ ok: true });
});
