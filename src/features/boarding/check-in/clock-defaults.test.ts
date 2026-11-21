import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { standingArrivalStatus } from "@/db/arrival-provenance";
import { bookingArrivalEvents } from "@/db/schema";
import { completeWaiver, issueWaiverRequest } from "@/db/waivers";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import {
  clearAnswers,
  manifestContext,
} from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { checkInBooking, undoCheckInBooking } from "./store";

describe("counter offline timestamp defaults", () => {
  it("records an arrival and its named undo at server time when device instants are absent", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("waiver request refused");
    await completeWaiver(db, issued.key, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    const arrivedAt = nowDate();
    const arrivalId = crypto.randomUUID();
    const common = {
      shopId: shop.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(arrivedAt.getTime() - 300_000),
      expectedTripId: reef.id,
    };
    await expect(
      checkInBooking(db, { ...common, clientEventId: arrivalId }),
    ).resolves.toMatchObject({ ok: true });
    expect(await standingArrivalStatus(db, shop.id, reef.id, booking.booking.id)).toBe("arrived");
    advanceClock();
    const clearedAt = nowDate();
    const undoId = crypto.randomUUID();
    await expect(
      undoCheckInBooking(db, {
        ...common,
        clientEventId: undoId,
        retractsClientEventId: arrivalId,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await standingArrivalStatus(db, shop.id, reef.id, booking.booking.id)).toBe("cleared");
    const rows = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.booking.id));
    expect(rows.find((row) => row.clientEventId === arrivalId)).toMatchObject({
      status: "arrived",
      occurredAt: arrivedAt,
    });
    expect(rows.find((row) => row.clientEventId === undoId)).toMatchObject({
      status: "cleared",
      occurredAt: clearedAt,
    });
  });
  it("refuses an arrival and undo for a seat that does not exist", async () => {
    const { db, shop, staff } = await manifestContext();
    const input = {
      shopId: shop.id,
      bookingId: crypto.randomUUID(),
      recordedByPersonId: staff.id,
      source: "offline" as const,
      clientEventId: crypto.randomUUID(),
      occurredAt: nowDate(),
      offlineSnapshotSavedAt: nowDate(),
    };
    await expect(checkInBooking(db, input)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(undoCheckInBooking(db, input)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
