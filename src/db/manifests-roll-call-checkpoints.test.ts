import { describe, expect, it, vi } from "vitest";
import {
  clearAnswers,
  manifestContext,
} from "../test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifests, recordRollCall } from "./manifests";
import { completeWaiver, issueWaiverRequest } from "./waivers";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

describe("roll call across checkpoints (in-memory PGlite)", () => {
  it("keeps the departure mark when a newer mark lands at a later checkpoint", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
    });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.key, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      occurredAt: new Date("2026-07-20T13:00:00.000Z"),
    });

    const manifests = await getTripManifests(db, shop.id, reef.id);
    const stateAt = (checkpoint: string) =>
      manifests
        ?.find((entry) => entry.checkpoint === checkpoint)
        ?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall?.state;
    // One statement reads every checkpoint, so the newest mark must win per
    // checkpoint, never per booking.
    expect(stateAt("departure")).toBe("boarded");
    expect(stateAt("after_dive_1")).toBe("not_boarded");
  });
});
