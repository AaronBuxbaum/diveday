import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { headCountView } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/head-count-view";
import { readManifestPage } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-reads";
import { offlineTripView } from "@/components/offline-manifest/trip-view";
import { staffSoulsOnBoardLine } from "@/i18n/participant-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { physicalPeople } from "@/lib/manifest-person-counts";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { OFFLINE_MANIFEST_RECORD_VERSION, serializeManifests } from "@/lib/offline-manifests";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { cancelBooking } from "./bookings";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { boats, people, personRoles, rollCallEvents, tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, setTripCrew, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

// Main c627897c5 on PostgreSQL16.15 reproduced 2 aboard for one dual-role person,
// and print15 versus14 unique identities. Both cancellation attempts were refused.
// Regression: one person keeps both role-specific trails and counts once physically.
describePostgres("#4308 supported dual-role writes on real Postgres", () => {
  it("counts a dual-role human once while preserving role conflict and cancellation refusal", async () => {
    const { db } = await postgresTestDb();
    const version = await db.execute(sql`select version() as version`);
    expect(version.rows[0]?.version).toContain("PostgreSQL");
    await seedDemo(db, "lean");
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("seeded shop missing");
    const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("seeded departure missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    const booking = roster[0];
    if (!booking) throw new Error("seeded booking missing");
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db.insert(personRoles).values({ personId: booking.person.id, role: "divemaster" });
    const existingCrew = await db
      .select()
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, reef.id));
    expect(
      await setTripCrew(db, shop.id, reef.id, [
        ...existingCrew.map((row) => row.personId),
        booking.person.id,
      ]),
    ).toBe(true);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("waiver issue failed");
    expect(
      await completeWaiver(db, issued.key, {
        signerName: booking.person.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      }),
    ).toMatchObject({ ok: true });
    // Exercise the production assembly, not just the arithmetic helper. There
    // are 15 role rows but 14 physical people; omitting `persons` at the actual
    // readManifestPage safety call would incorrectly raise a total-person notice.
    const physicalRoster = new Set([
      ...roster.map((row) => row.person.id),
      ...existingCrew.map((row) => row.personId),
    ]).size;
    expect(roster.length + existingCrew.length + 1).toBe(physicalRoster + 1);
    await db
      .update(boats)
      .set({ certifiedPassengers: 1, certifiedTotalPersons: physicalRoster })
      .where(eq(boats.shopId, shop.id));
    const assembled = await readManifestPage(db, shop, reef.id, actor);
    expect(assembled.boatSafety).not.toBeNull();
    expect(
      assembled.boatSafety?.notices.some((notice) => notice.code === "over_total_persons"),
    ).toBe(false);
    expect(assembled.boatSafety?.notices).toContainEqual({
      code: "over_certificate",
      passengers: roster.length,
      limit: 1,
      counted: false,
    });
    // The deliberately tiny local certificate reveals physical-person duplication.
    await db
      .update(boats)
      .set({ certifiedPassengers: 1, certifiedTotalPersons: 1 })
      .where(eq(boats.shopId, shop.id));

    for (const checkpoint of ["departure", "after_dive_1"] as const) {
      const input = {
        shopId: shop.id,
        tripId: reef.id,
        recordedByPersonId: actor,
        status: "boarded" as const,
        checkpoint,
      };
      expect(await recordRollCall(db, { ...input, bookingId: booking.booking.id })).toMatchObject({
        ok: true,
      });
      expect(await recordCrewRollCall(db, { ...input, personId: booking.person.id })).toMatchObject(
        { ok: true },
      );
      const manifest = await getTripManifest(db, shop.id, reef.id, checkpoint);
      if (!manifest) throw new Error("manifest missing");
      const live = headCountView({ manifest, checkpoint, isDeparture: checkpoint === "departure" });
      expect(live.overTotalPersons).toBeNull();
      const payload = serializeManifests([manifest], shop, () => "");
      const offline = offlineTripView(
        {
          snapshot: {
            ...payload,
            version: OFFLINE_MANIFEST_RECORD_VERSION,
            snapshotId: "probe-4308",
            savedAt: nowDate().toISOString(),
            expiresAt: "2026-08-04T13:30:00.000Z",
          },
          events: [],
          checklistEvents: [],
        },
        checkpoint,
      );
      expect(offline?.overTotalPersons).toBeNull();
      const printed = staffSoulsOnBoardLine(
        staffTranslator("en-US"),
        manifest.summary,
        manifest.crew.length,
        physicalPeople(manifest.divers, manifest.crew),
      );
      const uniqueRoster = new Set([
        ...roster.map((row) => row.person.id),
        ...manifest.crew.map((row) => row.id),
      ]).size;
      expect(manifest.summary.totalDivers + manifest.crew.length).toBe(uniqueRoster + 1);
      expect(printed).toContain(`Souls on board ${uniqueRoster}`);
      expect(printed).toContain("1 person has both roles");
      expect(offline?.physicalTotal).toBe(uniqueRoster);
      expect(manifest.summary.boarded).toBe(1);
      expect(manifest.crew.filter((member) => member.rollCall?.state === "boarded")).toHaveLength(
        1,
      );
    }
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: actor,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).toMatchObject({ ok: true });
    const conflict = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    if (!conflict) throw new Error("conflict manifest missing");
    const view = headCountView({
      manifest: conflict,
      checkpoint: "after_dive_1",
      isDeparture: false,
    });
    expect(view.notBackAboardDivers).toContainEqual({
      bookingId: booking.booking.id,
      fullName: booking.person.fullName,
    });
    expect(conflict.crew.find((row) => row.id === booking.person.id)?.rollCall?.state).toBe(
      "boarded",
    );
    expect(conflict.completeness.complete).toBe(false);
    const offlineConflict = offlineTripView(
      {
        snapshot: {
          ...serializeManifests([conflict], shop, () => ""),
          version: OFFLINE_MANIFEST_RECORD_VERSION,
          snapshotId: "conflict-4308",
          savedAt: nowDate().toISOString(),
          expiresAt: "2026-08-04T13:30:00.000Z",
        },
        events: [],
        checklistEvents: [],
      },
      "after_dive_1",
    );
    expect(offlineConflict?.notBackAboard).toBe(1);
    expect(offlineConflict?.completeness.complete).toBe(false);
    expect(
      offlineConflict?.crewWithState.find((member) => member.id === booking.person.id)?.state
        ?.state,
    ).toBe("boarded");
    expect(
      staffSoulsOnBoardLine(
        staffTranslator("en-US"),
        conflict.summary,
        conflict.crew.length,
        physicalPeople(conflict.divers, conflict.crew),
      ),
    ).toContain(`Souls on board ${roster.length + conflict.crew.length - 1}`);
    const cancellation = await cancelBooking(db, shop.id, booking.booking.id);
    expect(cancellation).toMatchObject({ ok: false, reason: "aboard_at_sea" });
    const laterCancellation = await cancelBooking(db, shop.id, booking.booking.id, {
      now: new Date(reef.endsAt.getTime() + 24 * 60 * 60 * 1000),
    });
    expect(laterCancellation).toMatchObject({ ok: false, reason: "aboard_at_sea" });
    const evidence = await db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.tripId, reef.id)));
    expect(evidence.filter((row) => row.bookingId === booking.booking.id)).toHaveLength(3);
    expect(evidence.filter((row) => row.crewPersonId === booking.person.id)).toHaveLength(2);
    expect(view.overTotalPersons).toBeNull();
    // A pre-existing erasure marker withholds identity from the historical seat.
    await db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, booking.person.id));
    const erased = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    const erasedSeat = erased?.divers.find((row) => row.bookingId === booking.booking.id);
    expect(erasedSeat).toBeDefined();
    expect(erasedSeat?.personId).toBeUndefined();
  });
});
