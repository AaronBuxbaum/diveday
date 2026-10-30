import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { clearAnswers, manifestContext } from "./manifests-test-fixtures";
import { markBookingNoShow } from "./no-show";
import { boats, trips } from "./schema";
import { getTripRoster } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

describe("manifest capacity warnings (in-memory PGlite)", () => {
  it("reports trip and boat over-capacity independently as roll call changes", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("expected waiver link");
    await completeWaiver(db, issued.token, {
      signerName: booking.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      now: reef.startsAt,
    });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    // Everyone else readiness clears, aboard too — counted rather than assumed,
    // so this stays about capacity whatever the demo roster's paperwork says.
    let aboard = 1;
    for (const row of await getTripRoster(db, shop.id, reef.id)) {
      if (row.booking.id === booking.booking.id) continue;
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: row.booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      });
      if (result.ok) aboard += 1;
    }

    await db.update(trips).set({ capacity: aboard }).where(eq(trips.id, reef.id));
    expect((await getTripManifest(db, shop.id, reef.id))?.summary).toMatchObject({
      boarded: aboard,
      overCapacity: 0,
    });
    // A lower trip limit is not a write the details form permits once seats
    // are held. This old/overfull state is placed directly; roll call still
    // uses the real writer.
    await db
      .update(trips)
      .set({ capacity: aboard - 1 })
      .where(eq(trips.id, reef.id));
    expect((await getTripManifest(db, shop.id, reef.id))?.summary.overCapacity).toBe(1);

    // The boat's configured capacity is separate from trip passenger capacity
    // and both certificate limits.
    await db.update(trips).set({ capacity: aboard }).where(eq(trips.id, reef.id));
    const [hull] = await db
      .insert(boats)
      .values({
        shopId: shop.id,
        name: "Certified hull",
        capacity: aboard,
        certifiedPassengers: aboard - 1,
      })
      .returning();
    if (!hull) throw new Error("boat not inserted");
    await db.update(trips).set({ boatId: hull.id }).where(eq(trips.id, reef.id));
    const withinConfiguredLimits = await getTripManifest(db, shop.id, reef.id);
    expect(withinConfiguredLimits?.summary).toMatchObject({
      overCapacity: 0,
      overBoatCapacity: 0,
    });

    const [assignedCrew] = withinConfiguredLimits?.crew ?? [];
    if (!assignedCrew) throw new Error("demo reef trip needs assigned crew");
    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: assignedCrew.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect((await getTripManifest(db, shop.id, reef.id))?.summary.overBoatCapacity).toBe(1);

    // Both configured thresholds can be exceeded together; neither warning
    // substitutes for the other.
    await db
      .update(trips)
      .set({ capacity: aboard - 1 })
      .where(eq(trips.id, reef.id));
    expect((await getTripManifest(db, shop.id, reef.id))?.summary).toMatchObject({
      overCapacity: 1,
      overBoatCapacity: 1,
    });

    // Clearing standing roll-call results removes those people from the count.
    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: assignedCrew.id,
        recordedByPersonId: staff.id,
        status: "cleared",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        status: "cleared",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect((await getTripManifest(db, shop.id, reef.id))?.summary).toMatchObject({
      boarded: aboard - 1,
      overCapacity: 0,
      overBoatCapacity: 0,
    });
  });
});
