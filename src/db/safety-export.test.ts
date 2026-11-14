import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { loadShopExportBundleInput, loadShopExportCounts } from "./export";
import { table } from "./export-bundle-table.test-support";
import {
  people,
  rollCallEventClaims,
  shops,
  unresolvedReviewDeferrals,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyScanIncidents,
} from "./schema";
import { createTrip, listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

it("exports each safety record only to its owning shop, including child delivery rows", async () => {
  const { db, shop } = ctx;
  const [rival] = await db
    .insert(shops)
    .values({ name: "Other shop", slug: "safety-export-other", timezone: "UTC" })
    .returning();
  const [ourTrip] = await upcomingTripsWithCounts(db, shop.id);
  const otherTrip = await createTrip(db, {
    shopId: rival.id,
    title: "Other trip",
    startsAt: new Date("2026-12-01T12:00:00Z"),
    endsAt: new Date("2026-12-01T16:00:00Z"),
    capacity: 12,
    plannedDives: 2,
  });
  const [staff] = await listStaff(db, shop.id);
  if (!ourTrip || !otherTrip || !staff) throw new Error("fixtures missing");
  const [foreignStaff] = await db
    .insert(people)
    .values({ shopId: rival.id, fullName: "Other staff" })
    .returning({ id: people.id });
  const write = async (shopId: string, tripId: string, personId: string) => {
    const [claim] = await db
      .insert(rollCallEventClaims)
      .values({ shopId, tripId, clientEventId: crypto.randomUUID(), state: "erased" })
      .returning();
    const [outbox] = await db
      .insert(unresolvedSafetyAlertOutbox)
      .values({ shopId, tripId, claimId: claim.id, generationId: crypto.randomUUID() })
      .returning();
    const [delivery] = await db
      .insert(unresolvedSafetyAlertDeliveries)
      .values({ outboxId: outbox.id, personId })
      .returning();
    const [escalation] = await db
      .insert(unresolvedSafetyAlertEscalations)
      .values({ outboxId: outbox.id, kind: "pending" })
      .returning();
    const [incident] = await db
      .insert(unresolvedSafetyScanIncidents)
      .values({
        outboxId: crypto.randomUUID(),
        generationId: crypto.randomUUID(),
        scanSequence: 999,
        shopId,
        tripId,
        claimId: claim.id,
      })
      .returning();
    const [deferral] = await db
      .insert(unresolvedReviewDeferrals)
      .values({
        shopId,
        tripId,
        claimId: claim.id,
        actorPersonId: personId,
        reviewRevision: claim.reviewRevision,
        requestId: crypto.randomUUID(),
      })
      .returning();
    return {
      outbox: outbox.id,
      delivery: delivery.id,
      escalation: escalation.id,
      incident: incident.id,
      deferral: deferral.id,
    };
  };
  const own = await write(shop.id, ourTrip.id, staff.person.id);
  const foreign = await write(rival.id, otherTrip.id, foreignStaff.id);
  const bundle = await loadShopExportBundleInput(db, shop.id);
  if (!bundle) throw new Error("bundle missing");
  for (const [file, kind] of [
    ["unresolved_safety_alert_outbox.csv", "outbox"],
    ["unresolved_safety_alert_deliveries.csv", "delivery"],
    ["unresolved_safety_alert_escalations.csv", "escalation"],
    ["unresolved_safety_scan_incidents.csv", "incident"],
    ["unresolved_review_deferrals.csv", "deferral"],
  ] as const) {
    const exported = table(bundle, file);
    const id = exported.header.indexOf("id");
    expect(exported.rows.some((row) => row[id] === own[kind])).toBe(true);
    expect(exported.rows.some((row) => row[id] === foreign[kind])).toBe(false);
  }
  const counts = await loadShopExportCounts(db, shop.id);
  if (!counts) throw new Error("count list missing");
  for (const file of [
    "unresolved_safety_alert_outbox.csv",
    "unresolved_safety_alert_deliveries.csv",
    "unresolved_safety_alert_escalations.csv",
    "unresolved_safety_scan_incidents.csv",
    "unresolved_review_deferrals.csv",
  ]) {
    expect(counts.find((row) => row.file === file)?.count).toBe(1);
  }
  // A malformed cross-shop recipient must fail the whole export, not leak
  // the other tenant's identifier or silently omit the damaged evidence.
  await db
    .insert(unresolvedSafetyAlertDeliveries)
    .values({ outboxId: own.outbox, personId: foreignStaff.id });
  await expect(loadShopExportBundleInput(db, shop.id)).rejects.toThrow(
    "Safety export has inconsistent tenant references",
  );
  await db
    .delete(unresolvedSafetyAlertDeliveries)
    .where(eq(unresolvedSafetyAlertDeliveries.personId, foreignStaff.id));
  await db.insert(rollCallEventClaims).values({
    shopId: shop.id,
    tripId: otherTrip.id,
    clientEventId: crypto.randomUUID(),
    state: "erased",
  });
  await expect(loadShopExportBundleInput(db, shop.id)).rejects.toThrow(
    "Safety export has inconsistent tenant references",
  );
});

it("preserves malformed JSON values and distinguishes JSON null from SQL NULL", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  const [staff] = await listStaff(db, shop.id);
  if (!trip || !staff) throw new Error("fixtures missing");
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "unresolved",
      subjectKind: "crew",
      crewPersonId: staff.person.id,
      intentFingerprint: "intent",
      proofFingerprint: "proof",
      keyFingerprint: "key",
      unresolvedReason: "meeting_identity_unverified",
      unresolvedRecordedByPersonId: staff.person.id,
      unresolvedObservation: false as never,
    })
    .returning({ id: rollCallEventClaims.id });
  const exported = async () => {
    const bundle = await loadShopExportBundleInput(db, shop.id);
    if (!bundle) throw new Error("bundle missing");
    const claims = table(bundle, "roll_call_event_claims.csv");
    const row = claims.rows.find((item) => item[claims.header.indexOf("id")] === claim.id);
    if (!row) throw new Error("claim missing");
    return row[claims.header.indexOf("unresolved_observation")];
  };
  expect(await exported()).toBe("false");
  await db
    .update(rollCallEventClaims)
    .set({ unresolvedObservation: sql`'null'::jsonb` })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await exported()).toBe("null");
  await db
    .update(rollCallEventClaims)
    .set({ unresolvedObservation: null, unresolvedRecordedByPersonId: null })
    .where(eq(rollCallEventClaims.id, claim.id));
  expect(await exported()).toBeNull();
});
