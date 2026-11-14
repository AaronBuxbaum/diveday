import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { deleteDemoSafetyTrail } from "./incident-reports";
import { recordRollCall } from "./manifests";
import { rollCallEventClaims, rollCallEvents } from "./schema";
import { deleteDemoShopCascade } from "./seed";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

for (const reset of ["safety trail", "whole demo"] as const) {
  it(`removes accepted and unresolved claims before their parents in ${reset}`, async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    if (!seat) throw new Error("booking missing");
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const common = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.booking.id,
      recordedByPersonId: actor,
      checkpoint: "after_dive_1" as const,
      status: "not_boarded" as const,
    };
    const acceptedId = crypto.randomUUID();
    expect(
      await recordRollCall(db, { ...common, source: "live", clientEventId: acceptedId }),
    ).toMatchObject({ ok: true });
    const unresolvedId = crypto.randomUUID();
    expect(
      await recordRollCall(db, {
        ...common,
        source: "offline",
        clientEventId: unresolvedId,
        offlineSnapshotId: crypto.randomUUID(),
        offlineSnapshotSavedAt: nowDate(),
        meetingDay: 0,
      }),
    ).toMatchObject({ ok: false, reason: "meeting_identity_unverified" });
    const before = await db
      .select()
      .from(rollCallEventClaims)
      .where(and(eq(rollCallEventClaims.shopId, shop.id), eq(rollCallEventClaims.tripId, trip.id)));
    expect(
      before
        .filter((row) => row.clientEventId === acceptedId || row.clientEventId === unresolvedId)
        .map((row) => row.state)
        .sort(),
    ).toEqual(["accepted", "unresolved"]);
    if (reset === "safety trail") await deleteDemoSafetyTrail(db, shop.id);
    else await deleteDemoShopCascade(db, shop.id);
    expect(
      await db.select().from(rollCallEventClaims).where(eq(rollCallEventClaims.shopId, shop.id)),
    ).toEqual([]);
    expect(
      await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id)),
    ).toEqual([]);
  });
}
