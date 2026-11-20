import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readOfflineManifestRosterWithWindows } from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import {
  getTripManifest,
  listDepartureRollCallByTrip,
  recordCrewRollCall,
  recordRollCall,
} from "./manifests";
import { effectiveCausalRowsForDb } from "./roll-call-causal-store";
import { boats, rollCallEvents, tripAssignments, trips } from "./schema";
import { seedDemo } from "./seed";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";
import { getShopBySlug } from "./shops";
import { editTripSection, getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("recount across meeting days", () => {
  it("carries invalidated missing evidence for diver and crew until a witnessed later sighting", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((item) =>
      item.title.startsWith("Two-Tank Reef — Molasses"),
    );
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!trip || !owner) throw new Error("fixture missing");
    const now = nowDate().getTime();
    expect(
      await editTripSection(pg.db, shop.id, trip.id, {
        scheduleDays: [
          {
            dayNumber: 1,
            startsAt: new Date(now - 2 * 86400000),
            endsAt: new Date(now - 2 * 86400000 + 3600000),
          },
          { dayNumber: 2, startsAt: new Date(now - 3600000), endsAt: new Date(now + 3600000) },
        ],
      }),
    ).toMatchObject({ ok: true });
    const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
    const before = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    const crew = before?.crew[0];
    const [tripRow] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    const [assignment] = crew
      ? await pg.db
          .select()
          .from(tripAssignments)
          .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, crew.id)))
      : [];
    if (!seat || !crew || !tripRow || !assignment || assignment.personId !== crew.id)
      throw new Error("subject fixture missing");
    await seedRollCallEvidence(pg.db, [
      {
        shopId: shop.id,
        tripId: trip.id,
        subjectKind: "seat",
        bookingId: seat.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        source: "offline",
        meetingDay: 0,
        occurredAt: new Date(now - 2 * 86400000 + 1800000),
        offlineMeetingGeneration: tripRow.offlineMeetingGeneration,
        offlineAssignmentGeneration: seat.booking.offlineAssignmentGeneration,
      },
      {
        shopId: shop.id,
        tripId: trip.id,
        subjectKind: "crew",
        crewPersonId: crew.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        source: "offline",
        meetingDay: 0,
        occurredAt: new Date(now - 2 * 86400000 + 1800000),
        offlineMeetingGeneration: tripRow.offlineMeetingGeneration,
        offlineCrewAssignmentId: assignment.offlineIncarnation,
      },
    ]);
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "not_boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await recordCrewRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: crew.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "not_boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    const [boat] = await pg.db
      .insert(boats)
      .values({ shopId: shop.id, name: "Replacement", capacity: 200 })
      .returning();
    if (!boat) throw new Error("boat missing");
    expect(await editTripSection(pg.db, shop.id, trip.id, { boatId: boat.id })).toMatchObject({
      ok: true,
    });
    const manifest = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    expect(manifest?.divers.find((item) => item.bookingId === seat.booking.id)).toMatchObject({
      recountRequired: true,
      rollCall: undefined,
    });
    expect(manifest?.crew.find((item) => item.id === crew.id)).toMatchObject({
      recountRequired: true,
      rollCall: undefined,
    });
    expect(
      (await listDepartureRollCallByTrip(pg.db, shop.id, [trip.id]))
        .get(trip.id)
        ?.has(seat.booking.id) ?? false,
    ).toBe(false);
    const dockRows = await pg.db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.tripId, trip.id), eq(rollCallEvents.checkpoint, "departure")));
    const projectedDock = await effectiveCausalRowsForDb(
      pg.db,
      dockRows.map((event) => ({ event, day: 1 })),
    );
    expect(
      projectedDock.some(
        ({ event }) => event.bookingId === seat.booking.id || event.crewPersonId === crew.id,
      ),
    ).toBe(false);
    const page = await readOfflineManifestRosterWithWindows(pg.db, shop.id, trip.id);
    const current = page?.manifests.find((item) => item.checkpoint === "after_dive_1");
    const seatProof = current?.divers.find((item) => item.bookingId === seat.booking.id)
      ?.rollCallContext?.liveRecountProof;
    const crewProof = current?.crew.find((item) => item.id === crew.id)?.rollCallContext
      ?.liveRecountProof;
    if (!seatProof || !crewProof) throw new Error("current proofs missing");
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        source: "live",
        liveRecountProof: seatProof,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await recordCrewRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: crew.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        source: "live",
        liveRecountProof: crewProof,
      }),
    ).toMatchObject({ ok: true });
    const events = await pg.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, trip.id));
    expect(
      events.find(
        (event) =>
          event.bookingId === seat.booking.id &&
          event.source === "live" &&
          event.checkpoint === "after_dive_1",
      ),
    ).toMatchObject({ meetingDay: 1, captureContext: { liveRecountVerified: true } });
    const resolved = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    expect(resolved?.divers.find((item) => item.bookingId === seat.booking.id)).toMatchObject({
      recountRequired: false,
      rollCall: { state: "boarded" },
    });
    expect(resolved?.crew.find((item) => item.id === crew.id)).toMatchObject({
      recountRequired: false,
      rollCall: { state: "boarded" },
    });
    await pg.db
      .update(rollCallEvents)
      .set({ meetingDay: null })
      .where(and(eq(rollCallEvents.tripId, trip.id), eq(rollCallEvents.source, "offline")));
    const [anotherBoat] = await pg.db
      .insert(boats)
      .values({ shopId: shop.id, name: "Another replacement", capacity: 200 })
      .returning();
    if (!anotherBoat) throw new Error("boat missing");
    expect(
      await editTripSection(pg.db, shop.id, trip.id, { boatId: anotherBoat.id }),
    ).toMatchObject({ ok: true });
    const ambiguous = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    expect(ambiguous?.divers.find((item) => item.bookingId === seat.booking.id)).toMatchObject({
      recountRequired: true,
      rollCall: undefined,
    });
    expect(ambiguous?.crew.find((item) => item.id === crew.id)).toMatchObject({
      recountRequired: true,
      rollCall: undefined,
    });
    const ambiguousPage = await readOfflineManifestRosterWithWindows(pg.db, shop.id, trip.id);
    const ambiguousProof = ambiguousPage?.manifests
      .find((item) => item.checkpoint === "after_dive_1")
      ?.divers.find((item) => item.bookingId === seat.booking.id)
      ?.rollCallContext?.liveRecountProof;
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: false, reason: "review_required" });
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        source: "live",
        liveRecountProof: ambiguousProof,
      }),
    ).toMatchObject({ ok: true });
    const ambiguousCrewProof = ambiguousPage?.manifests
      .find((item) => item.checkpoint === "after_dive_1")
      ?.crew.find((item) => item.id === crew.id)?.rollCallContext?.liveRecountProof;
    expect(
      await recordCrewRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: crew.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        source: "live",
        liveRecountProof: ambiguousCrewProof,
      }),
    ).toMatchObject({ ok: true });
    const recounted = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    expect(recounted?.divers.find((item) => item.bookingId === seat.booking.id)).toMatchObject({
      recountRequired: false,
      historicalReviewRequired: true,
      rollCall: { state: "boarded" },
    });
    expect(recounted?.crew.find((item) => item.id === crew.id)).toMatchObject({
      recountRequired: false,
      historicalReviewRequired: true,
      rollCall: { state: "boarded" },
    });
    expect(recounted?.summary.historicalReviewRequired).toBeGreaterThan(0);
    expect(recounted?.completeness.complete).toBe(false);
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        source: "live",
        liveRecountProof: ambiguousProof,
      }),
    ).toMatchObject({ ok: false, reason: "review_required" });
  });
});
