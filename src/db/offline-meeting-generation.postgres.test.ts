import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOfflineManifestCopies } from "@/features/boarding/offline-manifest-snapshots";
import { nextOfflineManifestSnapshotWithWindows } from "@/features/boarding/offline-manifest-snapshots/store";
import { getDayCloseout } from "@/features/day/today/closeout-reader";
import { departureCounts } from "@/features/trips/departure-counts";
import { recordTripStage } from "@/features/trips/trip-stages";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { aboardAtSeaBookingIds } from "./aboard-at-sea";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { moveBooking } from "./bookings";
import type { AppDb } from "./client";
import { getTripManifest, recordRollCall } from "./manifests";
import { readOfflineReviewIdentity } from "./offline-review-identity";
import {
  bookings,
  people,
  rollCallEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { seedDemo } from "./seed";
import { seedRollCallEvidence } from "./seed/roll-call-evidence";
import { getShopBySlug } from "./shops";
import { editTripSection, getTripRoster, listStaff, moveTrip } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline meeting generation", () => {
  it("does not open a name while an earlier erasure is uncommitted", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    if (!subject) throw new Error("seat missing");
    let entered!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const erasure = pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
      await tx
        .update(people)
        .set({ deletedAt: nowDate(), anonymizedAt: nowDate() })
        .where(eq(people.id, subject.booking.personId));
      entered();
      await gate;
    });
    await holding;
    const reading = readOfflineReviewIdentity(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      personId: subject.booking.personId,
      assignmentGeneration: subject.booking.offlineAssignmentGeneration,
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await erasure;
    }
    expect(await reading).toEqual({ name: null, sameAssignment: false });
  });
  it("advances when a save materially changes sub-millisecond meeting time", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [day] = await pg.db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, trip.id));
    if (!day) throw new Error("meeting day missing");
    await pg.db.execute(
      sql`update ${tripScheduleDays} set starts_at = starts_at + interval '1 microsecond' where id = ${day.id}`,
    );
    expect(
      (
        await editTripSection(pg.db, shop.id, trip.id, {
          scheduleDays: [{ dayNumber: day.dayNumber, startsAt: day.startsAt, endsAt: day.endsAt }],
        })
      ).ok,
    ).toBe(true);
    const [after] = await pg.db
      .select({ generation: trips.offlineMeetingGeneration })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after?.generation).not.toBe(0);
    await pg.db.execute(
      sql`update ${trips} set starts_at = starts_at + interval '1 microsecond' where id = ${trip.id}`,
    );
    expect((await editTripSection(pg.db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
    const [parentAfter] = await pg.db
      .select({ generation: trips.offlineMeetingGeneration })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(parentAfter?.generation).not.toBe(after?.generation);
  });
  it("keeps a no-op stable and advances through an end edit and revert", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const generation = async () => {
      const [row] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
      expect(row).toHaveProperty("offlineMeetingGeneration");
      return (row as typeof row & { offlineMeetingGeneration: number }).offlineMeetingGeneration;
    };
    const initial = await generation();
    // A generation is a fingerprint: every material change draws a number never seen before, and
    // reverting a change never returns to an earlier one.
    const seen = new Set([initial]);
    const expectFresh = async () => {
      const value = await generation();
      expect(seen.has(value)).toBe(false);
      seen.add(value);
      return value;
    };
    expect((await editTripSection(pg.db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
    expect(await generation()).toBe(initial);
    expect(
      (
        await editTripSection(pg.db, shop.id, trip.id, {
          endsAt: new Date(trip.endsAt.getTime() + 3600000),
        })
      ).ok,
    ).toBe(true);
    await expectFresh();
    expect((await editTripSection(pg.db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
    const reverted = await expectFresh();
    expect(await moveTrip(pg.db, shop.id, trip.id, trip.startsAt)).toMatchObject({ ok: true });
    expect(await generation()).toBe(reverted);
    expect(
      await moveTrip(pg.db, shop.id, trip.id, new Date(trip.startsAt.getTime() + 3600000)),
    ).toMatchObject({ ok: true });
    await expectFresh();
    expect(await moveTrip(pg.db, shop.id, trip.id, trip.startsAt)).toMatchObject({ ok: true });
    await expectFresh();
  });

  it("does not issue a capture while an earlier schedule writer is uncommitted", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    let entered!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = pg.connect().transaction(async (tx) => {
      await tx
        .update(trips)
        .set({ offlineMeetingGeneration: sql`${trips.offlineMeetingGeneration} + 1` }) // a fixed step so the test can name the value
        .where(eq(trips.id, trip.id));
      entered();
      await gate;
    });
    await holding;
    const capture = pg
      .connect()
      .transaction((tx) => nextOfflineManifestSnapshotWithWindows(tx, shop.id, trip.id));
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await writer;
    }
    const snapshot = await capture;
    const [committed] = await pg.db
      .select({ generation: trips.offlineMeetingGeneration })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(snapshot).toMatchObject({ meetingGeneration: committed?.generation });
    expect(committed?.generation).toBe(1);
  });
});

describePostgres("offline seat assignment generation", () => {
  it("advances when the same seat moves away and back", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const departures = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const trip = departures.find((row) => row.title.startsWith("Two-Tank Reef — Molasses"));
    const target = departures.find(
      (row) => row.id !== trip?.id && row.startsAt > (trip?.startsAt ?? new Date(0)),
    );
    if (!trip || !target) throw new Error("departures missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    if (!subject) throw new Error("subject missing");
    const generation = async () => {
      const [row] = await pg.db.select().from(bookings).where(eq(bookings.id, subject.booking.id));
      expect(row).toHaveProperty("offlineAssignmentGeneration");
      return (row as typeof row & { offlineAssignmentGeneration: number })
        .offlineAssignmentGeneration;
    };
    const initial = await generation();
    const seen = new Set([initial]);
    const expectFresh = async () => {
      const value = await generation();
      expect(seen.has(value)).toBe(false);
      seen.add(value);
    };
    expect(
      await moveBooking(pg.db, {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: target.id,
        bookingId: subject.booking.id,
      }),
    ).toMatchObject({ ok: true });
    await expectFresh();
    expect(
      await moveBooking(pg.db, {
        shopId: shop.id,
        fromTripId: target.id,
        toTripId: trip.id,
        bookingId: subject.booking.id,
      }),
    ).toMatchObject({ ok: true });
    await expectFresh();
  });
});

describePostgres("witnessed offline projection", () => {
  it("writes an explicitly confirmed current live mark once", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
    if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
    const confirmationId = crypto.randomUUID();
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      source: "live" as const,
      clientEventId: confirmationId,
      observedEvidenceIds: [],
      meetingDay: saved.rollCallMeetingDay ?? 0,
      offlineSnapshotId: saved.snapshotId,
      reviewWitness: witness,
      reviewOriginalWitness: witness,
      reviewOriginalSnapshotId: saved.snapshotId,
      reviewOriginalMeetingDay: saved.rollCallMeetingDay ?? 0,
    };
    const first = await recordRollCall(pg.db, input);
    expect(first).toMatchObject({ ok: true });
    expect(await recordRollCall(pg.db, input)).toMatchObject({ ok: true, duplicate: true });
    expect(
      await pg.db
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, confirmationId)),
    ).toHaveLength(1);
    expect(
      (await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === subject.booking.id,
      )?.rollCall?.state,
    ).toBe("boarded");
  });
  it("refuses a deliberate live confirmation when the reviewed meeting changed", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
    if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
    expect(
      (
        await editTripSection(pg.db, shop.id, trip.id, {
          endsAt: new Date(trip.endsAt.getTime() + 3600000),
        })
      ).ok,
    ).toBe(true);
    const confirmationId = crypto.randomUUID();
    const result = await recordRollCall(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "after_dive_1",
      status: "boarded",
      source: "live",
      clientEventId: confirmationId,
      observedEvidenceIds: [],
      meetingDay: saved.rollCallMeetingDay ?? 0,
      offlineSnapshotId: saved.snapshotId,
      reviewWitness: witness,
      reviewOriginalWitness: witness,
      reviewOriginalSnapshotId: saved.snapshotId,
      reviewOriginalMeetingDay: saved.rollCallMeetingDay ?? 0,
    });
    expect(result).toMatchObject({ ok: false, reason: "review_required" });
    expect(
      await pg.db
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, confirmationId)),
    ).toHaveLength(0);
  });
  it("does not let an invalidated offline dock exemption release an uncounted seat", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:departure`];
    if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "not_boarded",
        source: "offline",
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: [],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await editTripSection(pg.db, shop.id, trip.id, {
          endsAt: new Date(trip.endsAt.getTime() + 3600000),
        })
      ).ok,
    ).toBe(true);
    expect((await editTripSection(pg.db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
    const held = await aboardAtSeaBookingIds(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [subject.booking.id],
      now: new Date(trip.startsAt.getTime() + 3600000),
    });
    expect(held.get(subject.booking.id)).toBe("uncounted");
  });
  it("does not use an unbound crew exemption to release that person's seat", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    await pg.db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: subject.booking.personId })
      .onConflictDoNothing();
    await seedRollCallEvidence(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      subjectKind: "crew",
      crewPersonId: subject.booking.personId,
      recordedByPersonId: owner.person.id,
      checkpoint: "departure",
      status: "not_boarded",
      source: "offline",
      occurredAt: trip.startsAt,
    });
    const held = await aboardAtSeaBookingIds(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [subject.booking.id],
      now: new Date(trip.startsAt.getTime() + 3600000),
    });
    expect(held.get(subject.booking.id)).toBe("uncounted");
  });
  it("holds a stale dock sighting when crew say underway before scheduled departure", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:departure`];
    if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
    const at = new Date(trip.startsAt.getTime() - 3600000);
    const before = (await departureCounts(pg.db, shop.id, [trip.id], { now: at })).get(trip.id);
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "boarded",
        physicalPresenceOnly: true,
        source: "offline",
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: [],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await editTripSection(pg.db, shop.id, trip.id, {
          endsAt: new Date(trip.endsAt.getTime() + 3600000),
        })
      ).ok,
    ).toBe(true);
    expect(
      await recordTripStage(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        stage: "underway",
        recordedByPersonId: owner.person.id,
      }),
    ).toMatchObject({ ok: true });
    const held = await aboardAtSeaBookingIds(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [subject.booking.id],
      now: at,
    });
    expect(held.get(subject.booking.id)).toBe("uncertain");
    const after = (await departureCounts(pg.db, shop.id, [trip.id], { now: at })).get(trip.id);
    expect(after?.boarded).toBe(before?.boarded);
    expect(
      (await getTripManifest(pg.db, shop.id, trip.id, "departure"))?.divers.find(
        (diver) => diver.bookingId === subject.booking.id,
      )?.rollCall?.state,
    ).not.toBe("boarded");
  });
  it("keeps a separate uncertainty hold for an invalidated early-departure sighting", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
    if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        source: "offline",
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: [],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await editTripSection(pg.db, shop.id, trip.id, {
          endsAt: new Date(trip.endsAt.getTime() + 3600000),
        })
      ).ok,
    ).toBe(true);
    const held = await aboardAtSeaBookingIds(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [subject.booking.id],
      now: new Date(trip.startsAt.getTime() - 3600000),
    });
    expect(held.get(subject.booking.id)).toBe("uncertain");
    const target = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find(
      (row) => row.id !== trip.id && row.startsAt > trip.startsAt,
    );
    if (!target) throw new Error("target departure missing");
    expect(
      await moveBooking(pg.db, {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: target.id,
        bookingId: subject.booking.id,
      }),
    ).toMatchObject({ ok: false, reason: "roll_call_started" });
    expect(
      (await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === subject.booking.id,
      )?.rollCall?.state,
    ).not.toBe("boarded");
  });
  it("refuses the witnessed observation when a schedule move commits first", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
    if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
    let entered!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = moveTrip(
      pg.connect(),
      shop.id,
      trip.id,
      new Date(trip.startsAt.getTime() + 3600000),
      {
        beforeMove: async () => {
          entered();
          await gate;
        },
      },
    );
    await holding;
    const id = crypto.randomUUID();
    const intake = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      source: "offline",
      clientEventId: id,
      observedEvidenceIds: [],
      meetingDay: saved.rollCallMeetingDay ?? 0,
      offlineSnapshotId: saved.snapshotId,
      offlineErasureEpochToken: saved.erasureEpochToken,
      rollCallWitness: witness,
      offlineSnapshotSavedAt: nowDate(),
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    expect(await writer).toMatchObject({ ok: true });
    expect(await intake).toMatchObject({ ok: false, reason: "review_required" });
    expect(
      await pg.db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id)),
    ).toHaveLength(0);
  });
  it("holds a recount when a material edit invalidates accepted offline presence", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!trip) throw new Error("trip missing");
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!subject || !owner) throw new Error("fixture missing");
    const base = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "after_dive_1" as const,
    };
    expect(await recordRollCall(pg.db, { ...base, status: "not_boarded" })).toMatchObject({
      ok: true,
    });
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    if (!saved?.snapshotId) throw new Error("snapshot missing");
    const context = saved.manifests
      .find((manifest) => manifest.checkpoint === "after_dive_1")
      ?.divers.find((diver) => diver.bookingId === subject.booking.id)?.rollCallContext;
    const witness = saved.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
    if (!witness || !context) throw new Error("witness or context missing");
    const before = (await departureCounts(pg.db, shop.id, [trip.id], { now: trip.startsAt })).get(
      trip.id,
    );
    const closeAt = new Date(trip.endsAt.getTime() + 60_000);
    const beforeClose = (
      await getDayCloseout(pg.db, shop.id, shop.timezone, closeAt)
    ).departures.find((row) => row.tripId === trip.id);
    if (!beforeClose) throw new Error("closeout fixture missing");
    let entered!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intake = pg.connect().transaction(async (tx) => {
      const txDb = tx as unknown as AppDb;
      const outcome = await recordRollCall(txDb, {
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: context.observedEvidenceIds,
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      });
      expect(outcome).toMatchObject({ ok: true });
      expect(
        (await getTripManifest(txDb, shop.id, trip.id, "after_dive_1"))?.divers.find(
          (diver) => diver.bookingId === subject.booking.id,
        )?.rollCall?.state,
      ).toBe("boarded");
      entered();
      await gate;
      return outcome;
    });
    await holding;
    const writer = editTripSection(pg.connect(), shop.id, trip.id, {
      endsAt: new Date(trip.endsAt.getTime() + 3600000),
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    expect(await intake).toMatchObject({ ok: true });
    expect((await writer).ok).toBe(true);
    expect(
      (await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === subject.booking.id,
      ),
    ).toMatchObject({ recountRequired: true, rollCall: undefined });
    const after = (await departureCounts(pg.db, shop.id, [trip.id], { now: trip.startsAt })).get(
      trip.id,
    );
    expect(after?.back).toBe(before?.back);
    expect(after?.recountRequired).toBe(1);
    expect(after?.sailed).toBe((before?.sailed ?? 0) - 1);
    const afterClose = (
      await getDayCloseout(pg.db, shop.id, shop.timezone, closeAt)
    ).departures.find((row) => row.tripId === trip.id);
    expect(afterClose?.sailed).toBe(beforeClose.sailed - 1);
    expect(afterClose?.uncounted).toBeGreaterThan(0);
    expect(
      await pg.db
        .select()
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.tripId, trip.id),
            eq(rollCallEvents.bookingId, subject.booking.id),
            eq(rollCallEvents.source, "live"),
            eq(rollCallEvents.checkpoint, "after_dive_1"),
          ),
        ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ statementStatus: "not_boarded" })]),
    );
  });
});
