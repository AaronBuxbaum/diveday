import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { getBookingReadiness } from "./readiness";
import { bookings, rollCallEvents } from "./schema";

async function context() {
  const fixture = await manifestContext();
  const { db, shop, reef, booking, staff } = fixture;
  return {
    ...fixture,
    input: {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      status: "boarded" as const,
      observedEvidenceIds: [],
      meetingDay: 0,
    },
    bookingBefore: booking.booking,
    readinessBefore: await getBookingReadiness(db, shop.id, booking.booking.id),
  };
}

describe("explicit individual physical presence", () => {
  it("refuses a selected meeting day outside the trip schedule for either subject kind", async () => {
    const { db, shop, reef, input } = await context();
    const crewId = (await getTripManifest(db, shop.id, reef.id))?.crew[0]?.id;
    if (!crewId) throw new Error("fixture crew missing");
    for (const meetingDay of [-1, 0.5, 2]) {
      expect(await recordRollCall(db, { ...input, status: "not_boarded", meetingDay })).toEqual({
        ok: false,
        reason: "invalid_checkpoint",
      });
      expect(
        await recordCrewRollCall(db, {
          ...input,
          personId: crewId,
          status: "not_boarded",
          meetingDay,
        }),
      ).toEqual({ ok: false, reason: "invalid_checkpoint" });
    }
  });
  it("preserves the default refusal and records the exception without clearing requirements or changing the booking", async () => {
    const { db, shop, reef, input, bookingBefore, readinessBefore } = await context();
    expect(readinessBefore?.status).toBe("blocked");
    expect(await recordRollCall(db, input)).toEqual({ ok: false, reason: "not_ready" });
    const occurredAt = new Date(nowDate().getTime() - 60_000);
    const recorded = await recordRollCall(db, { ...input, physicalPresenceOnly: true, occurredAt });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error("physical presence refused");
    const [stored] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, recorded.eventId));
    expect(stored).toMatchObject({
      occurredAt,
      createdAt: nowDate(),
      readinessStatus: "blocked",
      readinessBlockers: readinessBefore?.blockers,
      captureContext: {
        physicalPresenceOnly: true,
      },
    });
    expect(await getBookingReadiness(db, shop.id, input.bookingId)).toEqual(readinessBefore);
    const [after] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId));
    expect(after).toEqual(bookingBefore);
    const manifest = await getTripManifest(db, shop.id, reef.id);
    expect(manifest?.divers.find((person) => person.bookingId === input.bookingId)).toMatchObject({
      readiness: readinessBefore,
      rollCall: { state: "boarded" },
    });
  });

  for (const released of ["no_show", "turned_away"] as const) {
    it(`refuses the physical exception on a ${released} seat without reclaiming it`, async () => {
      const { db, input } = await context();
      await db
        .update(bookings)
        .set({
          status: "no_show",
          ...(released === "turned_away" ? { turnedAwayAt: nowDate() } : {}),
        })
        .where(eq(bookings.id, input.bookingId));
      expect(await recordRollCall(db, { ...input, physicalPresenceOnly: true })).toEqual({
        ok: false,
        reason: "booking_unavailable",
      });
      expect(
        await db.select().from(rollCallEvents).where(eq(rollCallEvents.bookingId, input.bookingId)),
      ).toHaveLength(0);
    });
  }

  it("preserves the explicit intent across offline replay and refuses a changed exception flag", async () => {
    const { db, input } = await context();
    const event = {
      ...input,
      physicalPresenceOnly: true,
      source: "offline" as const,
      clientEventId: crypto.randomUUID(),
      offlineSnapshotSavedAt: nowDate(),
      occurredAt: nowDate(),
    };
    const first = await recordRollCall(db, event);
    expect(first.ok).toBe(true);
    expect(await recordRollCall(db, event)).toMatchObject({ ok: true, duplicate: true });
    expect(await recordRollCall(db, { ...event, physicalPresenceOnly: false })).toEqual({
      ok: false,
      reason: "client_event_conflict",
    });
  });

  it("does not let delayed physical presence silently reconcile opposing evidence", async () => {
    const { db, shop, reef, input } = await context();
    const missingId = crypto.randomUUID();
    const aboardId = crypto.randomUUID();
    await recordRollCall(db, { ...input, status: "not_boarded", clientEventId: missingId });
    await recordRollCall(db, { ...input, physicalPresenceOnly: true, clientEventId: aboardId });
    await recordRollCall(db, {
      ...input,
      physicalPresenceOnly: true,
      observedEvidenceIds: [missingId, aboardId].map(clientRollCallEvidenceId),
      occurredAt: new Date(nowDate().getTime() - 60_000),
    });
    const manifest = await getTripManifest(db, shop.id, reef.id);
    expect(
      manifest?.divers.find((person) => person.bookingId === input.bookingId)?.rollCall,
    ).toMatchObject({ evidenceConflict: true });
  });
});
