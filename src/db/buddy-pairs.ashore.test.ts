import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { dissolveBuddyTeam, formBuddyTeam } from "./buddy-pairs";
import { loadBuddyContext } from "./buddy-pairs-test-fixtures";
import { getTripManifest, recordRollCall } from "./manifests";

const ctx = fileScopedShopContext();
const buddyContext = () => loadBuddyContext(ctx);
const diver = (bookingId: string) => ({ kind: "diver" as const, bookingId });

describe("buddy teams — recorded ashore and re-pairing", () => {
  it("accepts an ashore record and prompts the remaining buddy until staff re-pair them", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    const formed = await formBuddyTeam(db, {
      ...base,
      members: [diver(a.booking.id), diver(b.booking.id)],
    });
    if (!formed.ok) throw new Error("expected a team");
    const before = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    // This seeded seat is blocked: a buddy team never weakens the dock gate.
    expect(
      await recordRollCall(db, {
        ...base,
        bookingId: a.booking.id,
        status: "boarded",
        checkpoint: "departure",
      }),
    ).toMatchObject({ ok: false, reason: "not_ready" });
    // A blocked diver may truthfully be marked ashore, and a later real
    // sighting after a dive is recordable regardless of their paperwork.
    expect(
      await recordRollCall(db, {
        ...base,
        bookingId: b.booking.id,
        status: "not_boarded",
        checkpoint: "departure",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await recordRollCall(db, {
        ...base,
        bookingId: a.booking.id,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).toMatchObject({ ok: true });
    const marked = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(marked?.divers.find((entry) => entry.bookingId === a.booking.id)).toMatchObject({
      buddyAlert: "teammate_ashore",
      buddyMissing: [b.person.fullName],
    });
    expect(marked?.divers.find((entry) => entry.bookingId === b.booking.id)?.buddyAlert).toBeNull();
    const next = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    // The dock absence remains ashore, never an after-dive non-return.
    expect(next?.divers.find((entry) => entry.bookingId === b.booking.id)?.rollCall?.implied).toBe(
      true,
    );
    expect(before?.divers.map((entry) => entry.readiness)).toEqual(
      marked?.divers.map((entry) => entry.readiness),
    );
    expect(await dissolveBuddyTeam(db, { ...base, teamId: formed.teamId })).toEqual({ ok: true });
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), diver(c.booking.id)] }),
    ).toMatchObject({ ok: true });
    // The new buddy is uncalled after the dive, so no alarm is earned.
    const repaired = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(
      repaired?.divers.find((entry) => entry.bookingId === a.booking.id)?.buddyAlert,
    ).toBeNull();
    expect(repaired?.summary).toEqual(marked?.summary);
    expect(repaired?.completeness).toEqual(marked?.completeness);
  });
});
