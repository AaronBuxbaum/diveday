import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import * as receiptSecrets from "@/lib/offline-receipt-secrets";
/**
 * **Causal evidence is scoped to the explicitly selected meeting day** (issue #3905,
 * ADR 20261104-roll-call-by-meeting-day). A checkpoint such as `after_dive_1`
 * repeats on every day of a course. Saturday's queued mark stays on Saturday;
 * opposing unknown-order statements on Sunday are retained as a conflict.
 *
 * Two meeting days: day one ended 22 hours ago, day two began 2 hours ago, so
 * the roll-call boundary between them sits 12 hours ago.
 */
import {
  capturedMeeting,
  HOUR,
  meetingGeneration,
  meetingIncarnation,
  shownContext,
  shownCrewContext,
  twoDayCourse,
} from "@/test/offline-meeting-test-support";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { offlineMeetingStillMatches } from "./offline-meeting-proof";
import { rollCallEvents, tripScheduleDays, trips } from "./schema";
import { editTripSection } from "./trips-record";

describe("offline roll call across meeting days", () => {
  it("does not accept an explicit meeting from another shop even with a scoped valid signature", async () => {
    const { db, reef } = await twoDayCourse();
    const [day] = await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, reef.id));
    if (!day) throw new Error("fixture meeting missing");
    const shopId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const proof = signOfflineMeetingIdentity({
      scheduleGeneration: await meetingGeneration(db, reef.id),
      datasetIncarnation: await meetingIncarnation(db, reef.id),
      shopId,
      tripId: reef.id,
      snapshotId,
      meetingId: day.id,
      startsAt: day.startsAt,
      endsAt: day.endsAt,
      meetingDay: 0,
    });
    expect(
      await offlineMeetingStillMatches(db, {
        shopId,
        tripId: reef.id,
        snapshotId,
        meetingDay: 0,
        proof,
      }),
    ).toBe(false);
  });
  it("does not accept an explicit meeting after its trip is deleted", async () => {
    const { db, shop, reef, now } = await twoDayCourse();
    const captured = await capturedMeeting(db, shop.id, reef.id, 0);
    await db
      .update(trips)
      .set({ deletedAt: new Date(now) })
      .where(eq(trips.id, reef.id));
    expect(
      await offlineMeetingStillMatches(db, {
        shopId: shop.id,
        tripId: reef.id,
        snapshotId: captured.offlineSnapshotId,
        meetingDay: 0,
        proof: captured.offlineMeetingIdentityProof,
      }),
    ).toBe(false);
  });
  it("accepts a captured implicit single meeting, but not after explicit days replace it", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
    const [trip] = await db.select().from(trips).where(eq(trips.id, reef.id));
    if (!trip) throw new Error("fixture trip missing");
    const snapshotId = crypto.randomUUID();
    const input = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      status: "not_boarded" as const,
      source: "offline" as const,
      clientEventId: crypto.randomUUID(),
      meetingDay: 0,
      offlineSnapshotId: snapshotId,
      offlineMeetingIdentityProof: signOfflineMeetingIdentity({
        scheduleGeneration: await meetingGeneration(db, reef.id),
        datasetIncarnation: await meetingIncarnation(db, reef.id),
        shopId: shop.id,
        tripId: reef.id,
        snapshotId,
        meetingId: reef.id,
        meetingDay: 0,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
      }),
      offlineSnapshotSavedAt: new Date(now - HOUR),
      occurredAt: new Date(now),
    };
    expect(await recordRollCall(db, input)).toMatchObject({ ok: true });
    await db
      .insert(tripScheduleDays)
      .values({ tripId: reef.id, dayNumber: 1, startsAt: trip.startsAt, endsAt: trip.endsAt });
    expect(
      await recordRollCall(db, { ...input, clientEventId: crypto.randomUUID() }),
    ).toMatchObject({ ok: false, reason: "meeting_identity_unverified" });
  });
  it("does not resurrect an implicit proof after explicit days are inserted and removed", async () => {
    const { db, shop, reef } = await twoDayCourse();
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
    const [trip] = await db.select().from(trips).where(eq(trips.id, reef.id));
    if (!trip) throw new Error("fixture trip missing");
    const snapshotId = crypto.randomUUID();
    const proof = signOfflineMeetingIdentity({
      scheduleGeneration: await meetingGeneration(db, reef.id),
      datasetIncarnation: await meetingIncarnation(db, reef.id),
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingId: reef.id,
      meetingDay: 0,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
    });
    expect(
      await editTripSection(db, shop.id, reef.id, {
        scheduleDays: [{ dayNumber: 1, startsAt: trip.startsAt, endsAt: trip.endsAt }],
        expectedScheduleDayIds: [],
        expectedScheduleVersion: "[]",
      }),
    ).toMatchObject({ ok: true });
    const [explicit] = await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, reef.id));
    if (!explicit) throw new Error("explicit meeting missing");
    expect(
      await editTripSection(db, shop.id, reef.id, {
        scheduleDays: [],
        expectedScheduleDayIds: [explicit.id],
        expectedScheduleVersion: JSON.stringify([
          [explicit.id, explicit.startsAt.toISOString(), explicit.endsAt.toISOString()],
        ]),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await offlineMeetingStillMatches(db, {
        shopId: shop.id,
        tripId: reef.id,
        snapshotId,
        meetingDay: 0,
        proof,
      }),
    ).toBe(false);
  });
  it("does not apply a queued mark to the same meeting moved to a different window", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const proof = await capturedMeeting(db, shop.id, reef.id, 1);
    const [day] = await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, reef.id));
    const days = await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, reef.id));
    const second = days.find((item) => item.dayNumber === 2);
    if (!day || !second) throw new Error("fixture meetings missing");
    await db
      .update(tripScheduleDays)
      .set({ startsAt: new Date(now + 24 * HOUR), endsAt: new Date(now + 28 * HOUR) })
      .where(eq(tripScheduleDays.id, second.id));
    const result = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure",
      status: "not_boarded",
      source: "offline",
      clientEventId: crypto.randomUUID(),
      meetingDay: 1,
      ...proof,
      offlineSnapshotSavedAt: new Date(now - HOUR),
      occurredAt: new Date(now),
    });
    expect(result).toMatchObject({ ok: false, reason: "meeting_identity_unverified" });
  });
  it("accepts a bound meeting proof and preserves duplicate replay", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const days = await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, reef.id));
    const second = days.find((day) => day.dayNumber === 2);
    if (!second) throw new Error("second meeting missing");
    const snapshotId = crypto.randomUUID();
    const proof = signOfflineMeetingIdentity({
      scheduleGeneration: await meetingGeneration(db, reef.id),
      datasetIncarnation: await meetingIncarnation(db, reef.id),
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingId: second.id,
      startsAt: second.startsAt,
      endsAt: second.endsAt,
      meetingDay: 1,
    });
    const input = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      status: "not_boarded" as const,
      source: "offline" as const,
      clientEventId: crypto.randomUUID(),
      meetingDay: 1,
      offlineSnapshotId: snapshotId,
      offlineMeetingIdentityProof: proof,
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
      occurredAt: new Date(now - HOUR),
      note: "First observation",
    };
    expect(await recordRollCall(db, input)).toMatchObject({ ok: true });
    expect(await recordRollCall(db, input)).toMatchObject({ ok: true, duplicate: true });
    expect(await recordRollCall(db, { ...input, note: "Different observation" })).toMatchObject({
      ok: false,
      reason: "client_event_conflict",
    });
    expect(await recordRollCall(db, { ...input, note: undefined })).toMatchObject({
      ok: true,
      duplicate: true,
      noteDisposition: "discarded_unverified_snapshot",
    });
    const priorKeys = receiptSecrets.offlineReceiptSecrets();
    const keys = vi
      .spyOn(receiptSecrets, "offlineReceiptSecrets")
      .mockReturnValue(["replacement receipt key", ...priorKeys]);
    try {
      expect(await recordRollCall(db, input)).toMatchObject({ ok: true, duplicate: true });
      keys.mockReturnValue(["replacement receipt key"]);
      expect(await recordRollCall(db, input)).toMatchObject({
        ok: false,
        reason: "claim_key_unavailable",
      });
    } finally {
      keys.mockRestore();
    }
    expect(
      await recordRollCall(db, {
        ...input,
        clientEventId: crypto.randomUUID(),
        offlineMeetingIdentityProof: `${proof}x`,
      }),
    ).toMatchObject({ ok: false, reason: "meeting_identity_unverified" });
  });
  it("does not file a queued day-two event on a newly inserted day two", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const prior = await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, reef.id));
    const second = prior.find((day) => day.dayNumber === 2);
    if (!second) throw new Error("second meeting missing");
    const snapshotId = crypto.randomUUID();
    const proof = signOfflineMeetingIdentity({
      scheduleGeneration: await meetingGeneration(db, reef.id),
      datasetIncarnation: await meetingIncarnation(db, reef.id),
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingId: second.id,
      startsAt: second.startsAt,
      endsAt: second.endsAt,
      meetingDay: 1,
    });
    // The device captured ordinal 1 before a day was inserted ahead of it.
    await db
      .update(tripScheduleDays)
      .set({ dayNumber: 3 })
      .where(eq(tripScheduleDays.id, second.id));
    await db.insert(tripScheduleDays).values({
      tripId: reef.id,
      dayNumber: 2,
      startsAt: new Date(now - 12 * HOUR),
      endsAt: new Date(now - 10 * HOUR),
    });
    const clientEventId = "11111111-2222-4333-8444-555555555555";
    const outcome = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure",
      status: "not_boarded",
      source: "offline",
      clientEventId,
      meetingDay: 1,
      offlineSnapshotId: snapshotId,
      offlineMeetingIdentityProof: proof,
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
      occurredAt: new Date(now - HOUR),
    });
    expect(outcome).toMatchObject({ ok: false, reason: "meeting_identity_unverified" });
    expect(
      await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, clientEventId)),
    ).toEqual([]);
  });
  it("does not refuse a day-one offline mark synced on day two because day two's mark is newer", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    // Sunday, online: the diver is not back.
    await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 1 * HOUR),
    });
    // Saturday's tap, queued offline, synced now.
    await expect(
      recordRollCall(db, {
        meetingDay: 0,
        ...base,
        status: "boarded",
        ...(await capturedMeeting(db, shop.id, reef.id, 0)),
        source: "offline",
        clientEventId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        offlineSnapshotSavedAt: new Date(now - 25 * HOUR),
        occurredAt: new Date(now - 23 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });
    const row = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
      (item) => item.bookingId === booking.booking.id,
    );
    expect(row?.rollCall).toMatchObject({ state: "not_boarded" });
    expect(row?.rollCallContext?.conflict).toBe(false);
    expect(
      (await db.select().from(rollCallEvents))
        .filter((item) => item.tripId === reef.id)
        .map((item) => item.meetingDay)
        .sort(),
    ).toEqual([0, 1]);
  });

  it("retains an older unknown-order offline mark beside opposing evidence on the same selected day", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 30 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "boarded",
        ...(await capturedMeeting(db, shop.id, reef.id, 1)),
        source: "offline",
        clientEventId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 90 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    const row = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
      (item) => item.bookingId === booking.booking.id,
    );
    expect(row?.rollCall).toMatchObject({ state: "not_boarded", evidenceConflict: true });
    expect(row?.rollCallContext).toMatchObject({ orderingUnknown: true });
    expect(row?.rollCallContext?.evidence).toHaveLength(2);
    expect(
      (await db.select().from(rollCallEvents))
        .filter((item) => item.tripId === reef.id)
        .map((item) => item.statementStatus)
        .sort(),
    ).toEqual(["boarded", "not_boarded"]);
  });

  it("does the same for the crew's own roll call", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordCrewRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 1 * HOUR),
    });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 0,
        ...base,
        status: "boarded",
        ...(await capturedMeeting(db, shop.id, reef.id, 0)),
        source: "offline",
        clientEventId: "cccccccc-2222-4222-8222-cccccccccccc",
        offlineSnapshotSavedAt: new Date(now - 25 * HOUR),
        occurredAt: new Date(now - 23 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "boarded",
        ...(await capturedMeeting(db, shop.id, reef.id, 1)),
        source: "offline",
        clientEventId: "dddddddd-2222-4222-8222-dddddddddddd",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 90 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    const row = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
      (item) => item.id === staff.id,
    );
    expect(row?.rollCall).toMatchObject({ state: "not_boarded", evidenceConflict: true });
    expect(row?.rollCallContext).toMatchObject({ orderingUnknown: true });
    expect(row?.rollCallContext?.evidence).toHaveLength(2);
    expect(
      (await db.select().from(rollCallEvents))
        .filter((item) => item.tripId === reef.id)
        .map((item) => item.meetingDay)
        .sort(),
    ).toEqual([0, 1, 1]);
  });
});

/**
 * **The live undo names the mark it takes back** (issue #3995). It applies
 * only while that mark is the one the manifest shows, so a repeated tap after
 * a same-day undo is refused rather than read as aimed at the carried row, and
 * an undo of the carried row itself reaches its own day.
 */
describe("a live undo across meeting days", () => {
  async function dayOneMissing() {
    const ctx = await twoDayCourse();
    const base = {
      shopId: ctx.shop.id,
      tripId: ctx.reef.id,
      bookingId: ctx.booking.booking.id,
      recordedByPersonId: ctx.staff.id,
      checkpoint: "after_dive_1" as const,
    };
    const dayOne = await recordRollCall(ctx.db, {
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(ctx.now - 23 * HOUR),
    });
    if (!dayOne.ok) throw new Error(dayOne.reason);
    const shown = async () =>
      (await getTripManifest(ctx.db, ctx.shop.id, ctx.reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === ctx.booking.booking.id,
      )?.rollCall;
    return { ...ctx, base, dayOne: dayOne.eventId, shown };
  }

  it("takes the carried row back after day two re-stated the diver and undid that", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    // Independent day-two restatement: it never observed day one's report.
    const dayTwo = await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!dayTwo.ok) throw new Error(dayTwo.reason);
    const beforeUndo = await shownContext(db, base.shopId, base.tripId, base.bookingId);
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayTwo.eventId,
        observedEvidenceIds: beforeUndo?.observedEvidenceIds,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    // The carried row is back, and says it came over from day one.
    expect(await shown()).toMatchObject({
      state: "not_boarded",
      eventId: dayOne,
      fromEarlierDay: true,
    });
    // A double tap of the same undo is refused: the alarm stays.
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayTwo.eventId,
        occurredAt: new Date(now - 45 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "not_boarded", eventId: dayOne });
    // The undo of the carried row names it, and takes it back.
    const carried = await shownContext(db, base.shopId, base.tripId, base.bookingId);
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayOne,
        observedEvidenceIds: carried?.observedEvidenceIds,
        occurredAt: new Date(now - 40 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await shown()).toBeUndefined();
  });

  it("refuses an undo of the carried row while day two's own mark stands", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    const before = await shownContext(db, base.shopId, base.tripId, base.bookingId);
    await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "boarded",
      observedEvidenceIds: before?.observedEvidenceIds,
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayOne,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "boarded" });
  });

  it("refuses a live undo after a dive that names nothing", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "not_boarded", eventId: dayOne });
  });

  it("refuses an undo naming another diver's mark", async () => {
    const { db, shop, reef, staff, base, now, dayOne } = await dayOneMissing();
    const crewMark = await recordCrewRollCall(db, {
      meetingDay: 1,
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!crewMark.ok) throw new Error(crewMark.reason);
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: crewMark.eventId,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        shopId: shop.id,
        tripId: reef.id,
        personId: staff.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1",
        status: "cleared",
        retractsEventId: dayOne,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
  });

  it("does the same for the crew's own roll call", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    const shown = async () =>
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
        (entry) => entry.id === staff.id,
      )?.rollCall;
    const dayOne = await recordCrewRollCall(db, {
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    const dayTwo = await recordCrewRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!dayOne.ok || !dayTwo.ok) throw new Error("crew marks refused");
    for (const [retractsEventId, minutesAgo, outcome] of [
      [dayTwo.eventId, 50, { ok: true }],
      [dayTwo.eventId, 45, { ok: false, reason: "retraction_superseded" }],
    ] as const) {
      const beforeUndo = await shownCrewContext(db, shop.id, reef.id, staff.id);
      await expect(
        recordCrewRollCall(db, {
          meetingDay: 1,
          ...base,
          status: "cleared",
          retractsEventId,
          observedEvidenceIds: beforeUndo?.observedEvidenceIds,
          occurredAt: new Date(now - minutesAgo * 60 * 1000),
        }),
      ).resolves.toMatchObject(outcome);
    }
    expect(await shown()).toMatchObject({ eventId: dayOne.eventId, fromEarlierDay: true });
    const carried = await shownCrewContext(db, shop.id, reef.id, staff.id);
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        observedEvidenceIds: carried.observedEvidenceIds,
        retractsEventId: dayOne.eventId,
        occurredAt: new Date(now - 40 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await shown()).toBeUndefined();
  });
});
